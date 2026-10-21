package postgres

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/identity"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type commentRow struct {
	ID, WorkspaceID, DocumentID, AuthorID, Body string
	ParentID                                    *string
	IsResolved                                  bool
	ResolvedAtMS                                *int64 `gorm:"column:resolved_at_ms"`
	Version                                     int64
	CreatedAtMS                                 int64 `gorm:"column:created_at_ms"`
	UpdatedAtMS                                 int64 `gorm:"column:updated_at_ms"`
}

func (commentRow) TableName() string { return "document_comments" }
func (r commentRow) domain(name string) document.Comment {
	return document.Comment{
		ID:           r.ID,
		WorkspaceID:  r.WorkspaceID,
		DocumentID:   r.DocumentID,
		AuthorID:     r.AuthorID,
		AuthorName:   name,
		Body:         r.Body,
		ParentID:     r.ParentID,
		IsResolved:   r.IsResolved,
		ResolvedAtMS: r.ResolvedAtMS,
		Version:      r.Version,
		CreatedAtMS:  r.CreatedAtMS,
		UpdatedAtMS:  r.UpdatedAtMS,
	}
}
func commentFor(tx *gorm.DB, scope document.DirectoryScope, id, strength string) (commentRow, error) {
	var row commentRow
	q := tx.Where("workspace_id = ? AND document_id = ? AND id = ?", scope.WorkspaceID, scope.DocumentID, id)
	if strength != "" {
		q = q.Clauses(clause.Locking{Strength: strength})
	}
	err := q.Take(&row).Error
	return row, missing(err)
}

// commentAccess freezes membership, collection location, group visibility, and document ancestry.
func commentAccess(ctx context.Context, tx *gorm.DB, scope document.DirectoryScope) error {
	if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Read); err != nil {
		return err
	}
	var row documentRow
	if err := tx.Where("workspace_id = ? AND id = ?", scope.WorkspaceID, scope.DocumentID).Take(&row).Error; err != nil {
		return missing(err)
	}
	scope.CollectionID = row.CollectionID
	if _, err := collectionFor(tx, scope, "SHARE", true); err != nil {
		return err
	}
	_, err := activeParent(tx, scope, &row.ID)
	return err
}
func commentResult(ctx context.Context, tx *gorm.DB, row commentRow) (document.Comment, error) {
	var user struct{ DisplayName *string }
	err := tx.WithContext(ctx).Table("users").Select("display_name").Where("id=?", row.AuthorID).Take(&user).Error
	return row.domain((identity.User{DisplayName: user.DisplayName}).Name()), err
}

func (r *Repository) Comments(ctx context.Context, scope document.DirectoryScope, page pagination.Page) ([]document.Comment, int64, error) {
	items := []document.Comment{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := New(tx).Get(ctx, scope.WorkspaceID, scope.DocumentID); err != nil {
			return err
		}
		q := tx.Table("document_comments c").Joins("JOIN users u ON u.id = c.author_id").Where("c.workspace_id = ? AND c.document_id = ?", scope.WorkspaceID, scope.DocumentID)
		if err := q.Count(&total).Error; err != nil {
			return err
		}
		var rows []struct {
			Record      commentRow `gorm:"embedded"`
			DisplayName *string
		}
		if err := q.Select("c.*, u.display_name").Order("c.created_at_ms, c.id").Offset(page.Offset()).Limit(page.Size).Scan(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			items = append(items, row.Record.domain((identity.User{DisplayName: row.DisplayName}).Name()))
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return items, total, err
}
func (r *Repository) CreateComment(ctx context.Context, input document.CommentInput) (document.Comment, error) {
	var result document.Comment
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := commentAccess(ctx, tx, input.Scope); err != nil {
			return err
		}
		if input.ParentID != nil {
			if _, err := commentFor(tx, input.Scope, *input.ParentID, ""); err != nil {
				return err
			}
		}
		row := commentRow{
			ID:          uuid.NewString(),
			WorkspaceID: input.Scope.WorkspaceID,
			DocumentID:  input.Scope.DocumentID,
			AuthorID:    input.Scope.ActorID,
			ParentID:    input.ParentID,
			Body:        input.Body,
			Version:     1,
			CreatedAtMS: input.Timestamp,
			UpdatedAtMS: input.Timestamp,
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		var err error
		result, err = commentResult(ctx, tx, row)
		return err
	})
	return result, err
}
func (r *Repository) UpdateComment(ctx context.Context, change document.CommentChange) (document.Comment, error) {
	var result document.Comment
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := commentAccess(ctx, tx, change.Scope); err != nil {
			return err
		}
		row, err := commentFor(tx, change.Scope, change.CommentID, "NO KEY UPDATE")
		if err != nil {
			return err
		}
		if row.AuthorID != change.Scope.ActorID {
			if change.Body != nil {
				return fault.Denied()
			}
			role, err := wsstore.New(tx).Role(ctx, change.Scope.WorkspaceID, change.Scope.ActorID)
			if err != nil {
				return err
			}
			if !workspace.Allowed(role, workspace.Edit) {
				return fault.Denied()
			}
		}
		if row.Version != change.ExpectedVersion {
			return versionConflict("COMMENT_VERSION_CONFLICT", "评论已变化，请刷新后重试", change.ExpectedVersion, row.Version)
		}
		if row.Version >= document.MaxVersion {
			return fault.New(fault.Conflict, "COMMENT_VERSION_EXHAUSTED", "评论版本号已达到上限")
		}
		if change.Body != nil {
			row.Body = *change.Body
		}
		if change.IsResolved != nil && *change.IsResolved != row.IsResolved {
			row.IsResolved = *change.IsResolved
			row.ResolvedAtMS = nil
			if row.IsResolved {
				row.ResolvedAtMS = &change.Timestamp
			}
		}
		row.Version++
		row.UpdatedAtMS = change.Timestamp
		if err := tx.Model(&commentRow{}).Where("id = ?", row.ID).Updates(map[string]any{
			"body":           row.Body,
			"is_resolved":    row.IsResolved,
			"resolved_at_ms": row.ResolvedAtMS,
			"version":        row.Version,
			"updated_at_ms":  row.UpdatedAtMS,
		}).Error; err != nil {
			return err
		}
		result, err = commentResult(ctx, tx, row)
		return err
	})
	return result, err
}
