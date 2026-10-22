package postgres

import (
	"context"
	"database/sql"
	"encoding/json"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/integration"
	itstore "orbis.local/orbis/internal/integration/postgres"
	"orbis.local/orbis/internal/workspace"
)

func (r *Library) versions(tx *gorm.DB) *document.Versions {
	return document.NewVersions(docstore.NewWithCollaboration(tx, r.collaboration), r.documents(tx), workspace.New(NewWorkspaces(tx), r.clock), r.clock, r.cursors)
}

func (r *Library) DocumentVersions(ctx context.Context, q integration.LibraryQuery) (document.VersionPage, error) {
	var result document.VersionPage
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, p, q.DocumentID, false); err != nil {
			return err
		}
		scope := document.DirectoryScope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID, DocumentID: q.DocumentID}
		result, err = r.versions(tx).List(ctx, document.VersionQuery{Scope: scope, Limit: q.Limit}, q.Cursor)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

func (r *Library) DocumentVersion(ctx context.Context, q integration.LibraryQuery, id string) (document.Version, document.Content, error) {
	var version document.Version
	var content document.Content
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, p, q.DocumentID, false); err != nil {
			return err
		}
		version, content, err = r.versions(tx).Content(ctx, document.DirectoryScope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID, DocumentID: q.DocumentID}, id)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return version, content, err
}

func (r *Library) CompareDocumentVersions(ctx context.Context, q integration.LibraryQuery, from, to string) (document.VersionComparison, error) {
	var result document.VersionComparison
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, p, q.DocumentID, false); err != nil {
			return err
		}
		result, err = r.versions(tx).Compare(ctx, document.DirectoryScope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID, DocumentID: q.DocumentID}, from, to, q.Cursor, q.Limit)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

// mutateVersion binds a version operation to the token and commits its receipt with the document transaction.
func mutateVersion[T any](ctx context.Context, r *Library, claimed integration.Principal, did, kind, operation string, input any, perform func(*gorm.DB, integration.Principal, document.DirectoryScope) (T, error)) (T, error) {
	var result T
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{integration.DocumentsWrite}, true)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, p, did, false); err != nil {
			return err
		}
		hash, err := integration.RequestHash(kind, did, input)
		if err != nil {
			return err
		}
		now := r.clock.Now().UnixMilli()
		receipt, err := itstore.ReserveOperation(ctx, tx, p, kind, operation, hash, nil, now)
		if err != nil {
			return err
		}
		if receipt.State == "completed" {
			return json.Unmarshal(receipt.Result, &result)
		}
		if _, err := r.tokens.Document(ctx, tx, p, did, true); err != nil {
			return err
		}
		if err := r.tokens.CheckTokenTime(p.Token); err != nil {
			return err
		}
		result, err = perform(tx, p, document.DirectoryScope{ActorID: p.UserID, WorkspaceID: p.Token.WorkspaceID, DocumentID: did})
		if err != nil {
			return err
		}
		return itstore.CompleteOperation(ctx, tx, p, operation, did, result, now)
	})
	return result, err
}

func (r *Library) SaveDocumentVersion(ctx context.Context, p integration.Principal, did string, input document.CreateVersion) (document.Version, error) {
	return mutateVersion(ctx, r, p, did, "version-create", input.OperationID, input, func(tx *gorm.DB, _ integration.Principal, scope document.DirectoryScope) (document.Version, error) {
		return r.versions(tx).Create(ctx, scope, input)
	})
}

func (r *Library) EditDocumentVersion(ctx context.Context, p integration.Principal, did, id string, input document.EditVersion) (document.Version, error) {
	request := struct {
		ID    string
		Input document.EditVersion
	}{id, input}
	return mutateVersion(ctx, r, p, did, "version-edit", input.OperationID, request, func(tx *gorm.DB, _ integration.Principal, scope document.DirectoryScope) (document.Version, error) {
		return r.versions(tx).Edit(ctx, scope, id, input)
	})
}

func (r *Library) RestoreDocumentVersion(ctx context.Context, p integration.Principal, did, id, operation string, expected int64) (document.Content, error) {
	request := struct {
		ID       string
		Expected int64
	}{id, expected}
	return mutateVersion(ctx, r, p, did, "version-restore", operation, request, func(tx *gorm.DB, principal integration.Principal, scope document.DirectoryScope) (document.Content, error) {
		_, content, err := r.versions(tx).Content(ctx, scope, id)
		if err != nil {
			return document.Content{}, err
		}
		doc, err := docstore.LockContent(ctx, tx, scope)
		if err != nil {
			return document.Content{}, err
		}
		if err := itstore.ValidateReferences(ctx, tx, principal, doc, []document.Operation{{Type: "insert_blocks", Blocks: content.Blocks}}); err != nil {
			return document.Content{}, err
		}
		return r.versions(tx).Restore(ctx, scope, id, operation, expected)
	})
}
