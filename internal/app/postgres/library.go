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
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/workspace"
)

type Library struct {
	collaboration document.CollaborationEngine
	db            *gorm.DB
	tokens        *itstore.Repository
	clock         clock.Clock
	cursors       *security.CursorSigner
}

func NewLibrary(db *gorm.DB, c clock.Clock, key string) *Library {
	return &Library{db: db, tokens: itstore.New(db, c), clock: c, cursors: security.NewCursorSigner("agent-reads:" + key)}
}
func NewLibraryWithCollaboration(db *gorm.DB, c clock.Clock, key string, engine document.CollaborationEngine) *Library {
	r := NewLibrary(db, c, key)
	r.collaboration = engine
	return r
}
func (r *Library) documents(tx *gorm.DB) *document.Service {
	return document.New(docstore.NewWithCollaboration(tx, r.collaboration), workspace.New(NewWorkspaces(tx), r.clock), r.clock, r.cursors)
}
func (r *Library) Commands(ctx context.Context, claimed integration.Principal, command document.Command) (document.CommandResult, error) {
	var result document.CommandResult
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{integration.DocumentsWrite}, true)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, principal, command.Scope.DocumentID, false); err != nil {
			return err
		}
		hash, err := integration.RequestHash("commands", command.Scope.DocumentID, command.Input)
		if err != nil {
			return err
		}
		did := command.Scope.DocumentID
		// Keep the document FK unset until its content lock is held; pre-lock KEY SHARE would deadlock concurrent writers.
		receipt, err := itstore.ReserveOperation(ctx, tx, principal, "commands", command.Input.OperationID, hash, nil, command.Timestamp)
		if err != nil {
			return err
		}
		if receipt.State == "completed" {
			if _, err := r.tokens.Document(ctx, tx, principal, did, false); err != nil {
				return err
			}
			return json.Unmarshal(receipt.Result, &result)
		}
		doc, err := r.tokens.Document(ctx, tx, principal, did, true)
		if err != nil {
			return err
		}
		if err := r.authorizeTableCopies(ctx, tx, principal, command.Input.TableCopies); err != nil {
			return err
		}
		if err := itstore.ValidateReferences(ctx, tx, principal, doc, command.Input.Operations); err != nil {
			return err
		}
		if err := r.tokens.CheckTokenTime(principal.Token); err != nil {
			return err
		}
		result, err = docstore.ApplyCommandsInTransaction(ctx, tx, command, r.collaboration)
		if err != nil {
			return err
		}
		return itstore.CompleteOperation(ctx, tx, principal, command.Input.OperationID, did, result, command.Timestamp)
	})
	return result, err
}
func (r *Library) Preview(ctx context.Context, claimed integration.Principal, command document.Command) (document.CommandPreview, error) {
	var result document.CommandPreview
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{integration.DocumentsWrite}, false)
		if err != nil {
			return err
		}
		doc, err := r.tokens.Document(ctx, tx, principal, command.Scope.DocumentID, false)
		if err != nil {
			return err
		}
		if err := r.authorizeTableCopies(ctx, tx, principal, command.Input.TableCopies); err != nil {
			return err
		}
		if err := itstore.ValidateReferences(ctx, tx, principal, doc, command.Input.Operations); err != nil {
			return err
		}
		result, err = docstore.New(tx).PreviewCommands(ctx, command)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Library) Operation(ctx context.Context, claimed integration.Principal, id string) (integration.OperationRecord, error) {
	var result integration.OperationRecord
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, claimed, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		row, err := itstore.FindOperation(ctx, tx, principal, id)
		if err != nil {
			return err
		}
		if row.DocumentID != nil {
			if _, err := r.tokens.Document(ctx, tx, principal, *row.DocumentID, false); err != nil {
				return err
			}
		}
		result = row.Public()
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

// A copy reads its source, even when the target is authorized for writing.
func (r *Library) authorizeTableCopies(ctx context.Context, tx *gorm.DB, principal integration.Principal, copies []document.TableCopy) error {
	if len(copies) == 0 {
		return nil
	}
	if err := principal.Require(integration.DocumentsRead); err != nil {
		return err
	}
	for _, copy := range copies {
		if copy.Source.WorkspaceID != principal.Token.WorkspaceID {
			return fault.Denied()
		}
		if _, err := r.tokens.Document(ctx, tx, principal, copy.Source.DocumentID, false); err != nil {
			return err
		}
	}
	return nil
}
