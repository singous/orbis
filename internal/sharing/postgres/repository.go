// Package postgres resolves live-share capabilities in consistent, workspace-bounded snapshots.
package postgres

import (
	"context"
	"database/sql"
	"errors"
	"net/url"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	boardstore "orbis.local/orbis/internal/board/postgres"
	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/document/publicview"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/sharing"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type Repository struct {
	boards *boardstore.Projector
	db     *gorm.DB
	clock  clock.Clock
	policy publicview.URLPolicy
}

func New(db *gorm.DB, c clock.Clock, publicBaseURL string, boards ...*boardstore.Projector) *Repository {
	policy := publicview.URLPolicy{}
	if parsed, err := url.Parse(publicBaseURL); err == nil && parsed.Hostname() != "" {
		policy.InternalHosts = []string{parsed.Hostname()}
	}
	var projector *boardstore.Projector
	if len(boards) > 0 {
		projector = boards[0]
	}
	return &Repository{boards: projector, db: db, clock: c, policy: policy}
}

type shareRow struct {
	ID, WorkspaceID, CollectionID, CreatedBy, TokenDigest string
	RootDocumentID                                        *string
	Version                                               int64
	ExpiresAtMS, RevokedAtMS                              *int64
	CreatedAtMS, UpdatedAtMS                              int64
}

func (shareRow) TableName() string { return "document_shares" }
func (row shareRow) domain() sharing.Share {
	return sharing.Share{ID: row.ID, WorkspaceID: row.WorkspaceID, CollectionID: row.CollectionID, CreatedBy: row.CreatedBy, Digest: row.TokenDigest, RootDocumentID: row.RootDocumentID, Version: row.Version, ExpiresAtMS: row.ExpiresAtMS, RevokedAtMS: row.RevokedAtMS, CreatedAtMS: row.CreatedAtMS, UpdatedAtMS: row.UpdatedAtMS}
}
func scopeError(err error) error {
	var business *fault.Error
	if errors.Is(err, gorm.ErrRecordNotFound) || (errors.As(err, &business) && business.Kind == fault.NotFound) {
		return sharing.Missing()
	}
	return err
}
func (r *Repository) Create(ctx context.Context, scope sharing.Scope, input sharing.Share) (sharing.Share, error) {
	var result sharing.Share
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = CreateInTransaction(ctx, tx, r.clock, scope, input)
		return err
	})
	return result, err
}
func CreateInTransaction(ctx context.Context, tx *gorm.DB, c clock.Clock, scope sharing.Scope, input sharing.Share) (sharing.Share, error) {
	row := shareRow{ID: input.ID, WorkspaceID: scope.WorkspaceID, CollectionID: input.CollectionID, CreatedBy: scope.ActorID, TokenDigest: input.Digest, RootDocumentID: input.RootDocumentID, Version: 1, ExpiresAtMS: input.ExpiresAtMS, CreatedAtMS: input.CreatedAtMS, UpdatedAtMS: input.UpdatedAtMS}
	err := func() error {
		if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Edit); err != nil {
			return err
		}
		if _, err := docstore.LockSnapshotCollection(ctx, tx, document.DirectoryScope{WorkspaceID: scope.WorkspaceID, CollectionID: row.CollectionID}); err != nil {
			return scopeError(err)
		}
		if row.RootDocumentID != nil {
			doc, err := docstore.New(tx).Get(ctx, scope.WorkspaceID, *row.RootDocumentID)
			if err != nil {
				return scopeError(err)
			}
			if doc.CollectionID != row.CollectionID {
				return sharing.Missing()
			}
		}
		if row.ExpiresAtMS != nil && *row.ExpiresAtMS <= c.Now().UnixMilli() {
			return fault.Field("body.expires_at_ms", "分享有效期已过，请重新设置")
		}
		return tx.Create(&row).Error
	}()
	return row.domain(), err
}
func (r *Repository) List(ctx context.Context, input sharing.ListQuery) ([]sharing.Share, int64, error) {
	items := []sharing.Share{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		role, err := wsstore.New(tx).Role(ctx, input.Scope.WorkspaceID, input.Scope.ActorID)
		if err != nil {
			return err
		}
		if !workspace.Allowed(role, workspace.Edit) {
			return fault.Denied()
		}
		q := tx.Model(&shareRow{}).Where("workspace_id=?", input.Scope.WorkspaceID)
		if input.CollectionID != nil {
			q = q.Where("collection_id=?", *input.CollectionID)
		}
		if input.RootSet {
			q = q.Where("root_document_id IS NOT DISTINCT FROM CAST(? AS UUID)", input.RootDocumentID)
		}
		if err := q.Count(&total).Error; err != nil {
			return err
		}
		var rows []shareRow
		if err := q.Order("created_at_ms DESC,id").Offset(input.Page.Offset()).Limit(input.Page.Size).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			items = append(items, row.domain())
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return items, total, err
}
func (r *Repository) Revoke(ctx context.Context, scope sharing.Scope, expected, timestamp int64) (sharing.Share, error) {
	var result sharing.Share
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = RevokeInTransaction(ctx, tx, scope, expected, timestamp)
		return err
	})
	return result, err
}
func RevokeInTransaction(ctx context.Context, tx *gorm.DB, scope sharing.Scope, expected, timestamp int64) (sharing.Share, error) {
	var row shareRow
	err := func() error {
		if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Edit); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).Where("workspace_id=? AND id=?", scope.WorkspaceID, scope.ShareID).Take(&row).Error; err != nil {
			return scopeError(err)
		}
		if row.RevokedAtMS != nil {
			return nil
		}
		if row.Version != expected {
			return &fault.Error{Kind: fault.Conflict, Code: "SHARE_VERSION_CONFLICT", Message: "分享状态已变化，请刷新后重试", Details: map[string]int64{"expected_version": expected, "current_version": row.Version}}
		}
		row.RevokedAtMS = &timestamp
		row.UpdatedAtMS = timestamp
		row.Version++
		return tx.Model(&shareRow{}).Where("id=?", row.ID).Updates(map[string]any{"revoked_at_ms": timestamp, "updated_at_ms": timestamp, "version": row.Version}).Error
	}()
	return row.domain(), err
}
func GetShare(ctx context.Context, tx *gorm.DB, wid, id string) (sharing.Share, error) {
	var row shareRow
	err := tx.WithContext(ctx).Where("workspace_id=? AND id=?", wid, id).Take(&row).Error
	return row.domain(), scopeError(err)
}

type scopeState struct {
	share      shareRow
	collection document.Collection
	root       *document.Document
}

func (r *Repository) resolve(ctx context.Context, tx *gorm.DB, input sharing.PublicQuery) (scopeState, error) {
	var rows []shareRow
	if err := tx.WithContext(ctx).Where("(token_digest=? OR token_digest=?) AND revoked_at_ms IS NULL", input.Digest, input.LegacyDigest).Limit(2).Find(&rows).Error; err != nil {
		return scopeState{}, err
	}
	if len(rows) != 1 {
		return scopeState{}, sharing.Missing()
	}
	share := rows[0]
	if share.ExpiresAtMS != nil && *share.ExpiresAtMS <= r.clock.Now().UnixMilli() {
		return scopeState{}, sharing.Missing()
	}
	if input.ShareID != "" && input.ShareID != share.ID {
		return scopeState{}, fault.Field("query.cursor", "游标不属于此分享")
	}
	collection, err := docstore.ReadSnapshotCollection(ctx, tx, document.DirectoryScope{WorkspaceID: share.WorkspaceID, CollectionID: share.CollectionID})
	if err != nil {
		return scopeState{}, scopeError(err)
	}
	state := scopeState{share: share, collection: collection}
	if share.RootDocumentID != nil {
		root, err := docstore.New(tx).Get(ctx, share.WorkspaceID, *share.RootDocumentID)
		if err != nil {
			return state, scopeError(err)
		}
		if root.CollectionID != share.CollectionID {
			return state, sharing.Missing()
		}
		state.root = &root
	}
	return state, nil
}
func (s scopeState) doc(ctx context.Context, tx *gorm.DB, id string, version int64) (document.Document, error) {
	if id == "" {
		return document.Document{}, sharing.Missing()
	}
	doc, err := docstore.New(tx).Get(ctx, s.share.WorkspaceID, id)
	if err != nil {
		return doc, scopeError(err)
	}
	if doc.CollectionID != s.share.CollectionID {
		return doc, sharing.Missing()
	}
	if s.root != nil {
		var included bool
		err := tx.WithContext(ctx).Raw(`WITH RECURSIVE ancestors AS (
          SELECT id,parent_id,1 AS depth FROM documents WHERE workspace_id=? AND collection_id=? AND id=?
          UNION ALL SELECT d.id,d.parent_id,a.depth+1 FROM documents d JOIN ancestors a ON d.id=a.parent_id
          WHERE d.workspace_id=? AND d.collection_id=? AND a.depth<?
        ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=?)`, s.share.WorkspaceID, s.share.CollectionID, id, s.share.WorkspaceID, s.share.CollectionID, document.MaxDirectoryDepth, s.root.ID).Scan(&included).Error
		if err != nil {
			return doc, err
		}
		if !included {
			return doc, sharing.Missing()
		}
	}
	if version != 0 && version != doc.ContentVersion {
		return doc, sharing.ContentChanged()
	}
	return doc, nil
}

const treeSQL = `WITH RECURSIVE tree AS (
    SELECT d.id,d.parent_id,d.title,d.position,d.content_version,d.updated_at_ms,1 AS depth FROM documents d
    WHERE d.workspace_id=@workspace AND d.collection_id=@collection AND d.is_archived = FALSE
      AND ((CAST(@root AS UUID) IS NULL AND d.parent_id IS NULL) OR d.id=CAST(@root AS UUID))
    UNION ALL SELECT d.id,d.parent_id,d.title,d.position,d.content_version,d.updated_at_ms,t.depth+1
      FROM documents d JOIN tree t ON d.parent_id=t.id
      WHERE d.workspace_id=@workspace AND d.collection_id=@collection AND d.is_archived = FALSE AND t.depth<@depth
) `

func (s scopeState) treeArgs() []any {
	return []any{sql.Named("workspace", s.share.WorkspaceID), sql.Named("collection", s.share.CollectionID), sql.Named("root", s.share.RootDocumentID), sql.Named("depth", document.MaxDirectoryDepth)}
}
func (r *Repository) Directory(ctx context.Context, input sharing.PublicQuery) (sharing.Directory, error) {
	result := sharing.Directory{Items: []sharing.Node{}}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		scope, err := r.resolve(ctx, tx, input)
		if err != nil {
			return err
		}
		if input.DirectoryVersion != 0 && input.DirectoryVersion != scope.collection.DirectoryVersion {
			return fault.New(fault.Conflict, "SHARE_DIRECTORY_CHANGED", "分享目录已变化，请重新读取")
		}
		result.Title = scope.collection.Title
		result.RootDocumentID = scope.share.RootDocumentID
		result.DirectoryVersion = scope.collection.DirectoryVersion
		condition := "parent_id IS NULL"
		if scope.root != nil {
			result.Title = scope.root.Title
			if input.ParentID == nil {
				condition = "id=CAST(@root AS UUID)"
			}
		}
		if input.ParentID != nil {
			if _, err := scope.doc(ctx, tx, *input.ParentID, 0); err != nil {
				return err
			}
			condition = "parent_id=CAST(@parent AS UUID)"
		}
		args := append(scope.treeArgs(), sql.Named("parent", input.ParentID), sql.Named("limit", input.Page.Size), sql.Named("offset", input.Page.Offset()))
		if err := tx.Raw(treeSQL+"SELECT count(*) FROM tree WHERE "+condition, args...).Scan(&result.Total).Error; err != nil {
			return err
		}
		if err := tx.Raw(treeSQL+"SELECT id,parent_id,title,position,content_version,updated_at_ms FROM tree WHERE "+condition+" ORDER BY position,id LIMIT @limit OFFSET @offset", args...).Scan(&result.Items).Error; err != nil {
			return err
		}
		if scope.root != nil {
			for i := range result.Items {
				if result.Items[i].ID == scope.root.ID {
					result.Items[i].ParentID = nil
				}
			}
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func publicDocument(doc document.Document) sharing.Document {
	return sharing.Document{ID: doc.ID, Title: doc.Title, ContentVersion: doc.ContentVersion, UpdatedAtMS: doc.UpdatedAtMS}
}
func (r *Repository) Document(ctx context.Context, input sharing.PublicQuery) (sharing.Document, error) {
	var result sharing.Document
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		scope, err := r.resolve(ctx, tx, input)
		if err != nil {
			return err
		}
		doc, err := scope.doc(ctx, tx, input.DocumentID, input.Version)
		if err != nil {
			return err
		}
		result = publicDocument(doc)
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
