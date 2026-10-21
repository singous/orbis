package postgres

import (
	"context"
	"database/sql"
	"strings"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/integration"
)

const libraryVisibleSQL = `WITH RECURSIVE visible AS (
 SELECT d.*,1 AS depth FROM documents d JOIN collections c ON c.id=d.collection_id AND c.workspace_id=d.workspace_id
 JOIN collection_groups g ON g.id=c.group_id AND g.workspace_id=c.workspace_id
 WHERE d.workspace_id=@workspace AND d.parent_id IS NULL AND d.is_archived = FALSE AND c.is_archived = FALSE AND g.is_archived = FALSE
 UNION ALL SELECT d.*,v.depth+1 FROM documents d JOIN visible v ON d.parent_id=v.id AND d.collection_id=v.collection_id
 WHERE d.workspace_id=@workspace AND d.is_archived = FALSE AND v.depth<@depth
) `

func (r *Library) Collections(ctx context.Context, q integration.LibraryQuery) ([]document.Collection, int64, error) {
	result := []document.Collection{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		scope := document.DirectoryScope{ActorID: principal.UserID, WorkspaceID: principal.Token.WorkspaceID}
		if principal.Token.DocumentID != nil {
			if _, err := r.tokens.Document(ctx, tx, principal, *principal.Token.DocumentID, false); err != nil {
				return err
			}
		}
		if principal.Token.CollectionID != nil {
			collection, err := docstore.ReadSnapshotCollection(ctx, tx, document.DirectoryScope{WorkspaceID: scope.WorkspaceID, CollectionID: *principal.Token.CollectionID})
			if err != nil {
				return err
			}
			total = 1
			if q.Page.Number == 1 {
				result = append(result, collection)
			}
			return nil
		}
		result, total, err = docstore.New(tx).ListCollections(ctx, document.CollectionQuery{Scope: scope, Page: q.Page})
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, total, err
}
func (r *Library) Documents(ctx context.Context, q integration.LibraryQuery) ([]document.Document, int64, error) {
	result := []document.Document{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		result, total, err = r.listDocuments(ctx, tx, q, principal)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, total, err
}
func (r *Library) listDocuments(ctx context.Context, tx *gorm.DB, q integration.LibraryQuery, principal integration.Principal) ([]document.Document, int64, error) {
	result := []document.Document{}
	var total int64
	where := []string{"TRUE"}
	args := []any{sql.Named("workspace", principal.Token.WorkspaceID), sql.Named("depth", document.MaxDirectoryDepth), sql.Named("limit", q.Page.Size), sql.Named("offset", q.Page.Offset())}
	if principal.Token.CollectionID != nil {
		where = append(where, "v.collection_id=CAST(@token_collection AS UUID)")
		args = append(args, sql.Named("token_collection", *principal.Token.CollectionID))
	}
	if principal.Token.DocumentID != nil {
		where = append(where, "v.id=CAST(@token_document AS UUID)")
		args = append(args, sql.Named("token_document", *principal.Token.DocumentID))
	}
	if q.CollectionID != nil {
		where = append(where, "v.collection_id=CAST(@collection AS UUID)")
		args = append(args, sql.Named("collection", *q.CollectionID))
	}
	if q.DocumentID != "" {
		where = append(where, "v.id=CAST(@document AS UUID)")
		args = append(args, sql.Named("document", q.DocumentID))
	}
	if q.ParentSet {
		where = append(where, "v.parent_id IS NOT DISTINCT FROM CAST(@parent AS UUID)")
		args = append(args, sql.Named("parent", q.ParentID))
	}
	if q.ExactTitle != nil {
		where = append(where, "v.title=@title")
		args = append(args, sql.Named("title", *q.ExactTitle))
	}
	if q.Text != "" {
		where = append(where, "(strpos(lower(v.title),lower(@query))>0 OR EXISTS(SELECT 1 FROM document_block_versions b WHERE b.document_id=v.id AND b.valid_to IS NULL AND strpos(lower(b.plain_text),lower(@query))>0))")
		args = append(args, sql.Named("query", q.Text))
	}
	filter := strings.Join(where, " AND ")
	if err := tx.Raw(libraryVisibleSQL+"SELECT count(*) FROM visible v WHERE "+filter, args...).Scan(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []struct {
		ID, WorkspaceID, CollectionID, Title string
		ContentVersion                       int64
		ParentID                             *string
		Position                             int
		ArchivedAtMS                         *int64
		IsArchived                           bool
		CreatedAtMS, UpdatedAtMS             int64
	}
	if err := tx.Raw(libraryVisibleSQL+"SELECT v.* FROM visible v WHERE "+filter+" ORDER BY v.updated_at_ms DESC,v.id LIMIT @limit OFFSET @offset", args...).Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	for _, row := range rows {
		result = append(result, document.Document{ID: row.ID, WorkspaceID: row.WorkspaceID, CollectionID: row.CollectionID, Title: row.Title, ContentVersion: row.ContentVersion, ParentID: row.ParentID, Position: row.Position, ArchivedAtMS: row.ArchivedAtMS, IsArchived: row.IsArchived, CreatedAtMS: row.CreatedAtMS, UpdatedAtMS: row.UpdatedAtMS})
	}
	return result, total, nil
}
func (r *Library) Document(ctx context.Context, q integration.LibraryQuery) (document.Document, error) {
	var result document.Document
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		result, err = r.tokens.Document(ctx, tx, principal, q.DocumentID, false)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Library) Content(ctx context.Context, q integration.LibraryQuery) (document.Content, error) {
	var result document.Content
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, principal, q.DocumentID, false); err != nil {
			return err
		}
		revision, records, err := docstore.New(tx).Read(ctx, principal.Token.WorkspaceID, q.DocumentID, q.Version)
		if err != nil {
			return err
		}
		blocks, err := document.Expand(records)
		if err != nil {
			return err
		}
		result = document.Content{Revision: revision, Blocks: blocks}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func readParameters(q integration.LibraryQuery) document.ReadQuery {
	return document.ReadQuery{Scope: q.Scope(), Version: q.Version, SinceVersion: q.SinceVersion, ParentID: q.ParentID, BlockID: q.BlockID, Limit: q.Limit}
}
func (r *Library) BlockWindow(ctx context.Context, q integration.LibraryQuery, kind string) (document.WindowPage, error) {
	var result document.WindowPage
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, principal, q.DocumentID, false); err != nil {
			return err
		}
		q.Principal = principal
		if kind == "children" {
			result, err = r.documents(tx).ChildrenBlocks(ctx, readParameters(q), q.Cursor)
		} else {
			items, next, more, version, readErr := r.documents(tx).Blocks(ctx, principal.UserID, principal.Token.WorkspaceID, q.DocumentID, q.Version, q.Cursor, q.Limit)
			result = document.WindowPage{Items: items, Version: version, NextCursor: next, HasMore: more}
			err = readErr
		}
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Library) Block(ctx context.Context, q integration.LibraryQuery) (document.BlockRecord, int64, error) {
	var result document.BlockRecord
	var version int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, principal, q.DocumentID, false); err != nil {
			return err
		}
		q.Principal = principal
		result, version, err = r.documents(tx).ReadBlock(ctx, readParameters(q))
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, version, err
}
func (r *Library) Outline(ctx context.Context, q integration.LibraryQuery) (document.HeadingPage, error) {
	var result document.HeadingPage
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, principal, q.DocumentID, false); err != nil {
			return err
		}
		q.Principal = principal
		result, err = r.documents(tx).Outline(ctx, readParameters(q), q.Cursor)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Library) Changes(ctx context.Context, q integration.LibraryQuery) (document.ChangePage, error) {
	var result document.ChangePage
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		principal, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, principal, q.DocumentID, false); err != nil {
			return err
		}
		q.Principal = principal
		result, err = r.documents(tx).Changes(ctx, readParameters(q), q.Cursor)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

func (r *Library) Export(ctx context.Context, q integration.LibraryQuery) (integration.ExportSnapshot, error) {
	var result integration.ExportSnapshot
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := r.tokens.RequirePrincipal(ctx, tx, q.Principal, []integration.Permission{integration.DocumentsRead}, false)
		if err != nil {
			return err
		}
		if _, err := r.tokens.Document(ctx, tx, p, q.DocumentID, false); err != nil {
			return err
		}
		if q.Format == "json" {
			revision, records, err := docstore.New(tx).Read(ctx, p.Token.WorkspaceID, q.DocumentID, q.Version)
			if err != nil {
				return err
			}
			blocks, err := document.Expand(records)
			if err != nil {
				return err
			}
			result = integration.ExportSnapshot{Content: document.Content{Revision: revision, Blocks: blocks}, Tables: map[string][]byte{}}
			return nil
		}
		result, err = NewTransfers(tx).Export(ctx, integration.ExportQuery{Scope: q.Scope(), Version: q.Version})
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
