package postgres

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type groupRow struct {
	IsArchived            bool
	ID, WorkspaceID, Name string
	IsDefault             bool
	SortOrder             int
	Version               int64
	ArchivedAtMS          *int64 `gorm:"column:archived_at_ms"`
	CreatedAtMS           int64  `gorm:"column:created_at_ms"`
	UpdatedAtMS           int64  `gorm:"column:updated_at_ms"`
}

func (groupRow) TableName() string { return "collection_groups" }
func (r groupRow) domain() document.Group {
	return document.Group{
		ID:           r.ID,
		WorkspaceID:  r.WorkspaceID,
		Name:         r.Name,
		IsDefault:    r.IsDefault,
		SortOrder:    r.SortOrder,
		Version:      r.Version,
		ArchivedAtMS: r.ArchivedAtMS, IsArchived: r.IsArchived,
		CreatedAtMS: r.CreatedAtMS,
		UpdatedAtMS: r.UpdatedAtMS,
	}
}

// InsertDefaultGroup joins the caller's workspace initialization transaction.
func InsertDefaultGroup(ctx context.Context, tx *gorm.DB, workspaceID string, timestamp int64) error {
	return tx.WithContext(ctx).Create(&groupRow{
		ID: uuid.NewString(), WorkspaceID: workspaceID, Name: document.DefaultGroupName,
		IsDefault: true, Version: 1, CreatedAtMS: timestamp, UpdatedAtMS: timestamp,
	}).Error
}

func groupFor(tx *gorm.DB, wid string, id *string, strength string, active bool) (groupRow, error) {
	q := tx.Where("workspace_id = ?", wid)
	if id == nil {
		q = q.Where("is_default")
	} else {
		q = q.Where("id = ?", *id)
	}
	if strength != "" {
		q = q.Clauses(clause.Locking{Strength: strength})
	}
	var row groupRow
	if err := q.Take(&row).Error; err != nil {
		return row, missing(err)
	}
	if active && row.IsArchived {
		return row, fault.Missing()
	}
	return row, nil
}

func versionConflict(code, message string, expected, current int64) error {
	return &fault.Error{Kind: fault.Conflict, Code: code, Message: message, Details: map[string]int64{"expected_version": expected, "current_version": current}}
}
func (r *Repository) Groups(ctx context.Context, scope document.DirectoryScope, page pagination.Page, archived bool) ([]document.Group, int64, error) {
	items := []document.Group{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		q := tx.Model(&groupRow{}).Where("workspace_id = ? AND (is_archived = TRUE) = ?", scope.WorkspaceID, archived)
		if err := q.Count(&total).Error; err != nil {
			return err
		}
		var rows []groupRow
		if err := q.Order("sort_order, id").Offset(page.Offset()).Limit(page.Size).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			items = append(items, row.domain())
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return items, total, err
}
func (r *Repository) Group(ctx context.Context, scope document.DirectoryScope, id string) (document.Group, error) {
	row, err := groupFor(r.db.WithContext(ctx), scope.WorkspaceID, &id, "", false)
	return row.domain(), err
}
func (r *Repository) CreateGroup(ctx context.Context, change document.GroupChange) (document.Group, error) {
	row := groupRow{
		ID:          uuid.NewString(),
		WorkspaceID: change.Scope.WorkspaceID,
		Name:        *change.Name,
		Version:     1,
		CreatedAtMS: change.Timestamp,
		UpdatedAtMS: change.Timestamp,
	}
	if change.SortOrder != nil {
		row.SortOrder = *change.SortOrder
	}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := wsstore.RequireLocked(ctx, tx, row.WorkspaceID, change.Scope.ActorID, workspace.Edit); err != nil {
			return err
		}
		return tx.Create(&row).Error
	})
	return row.domain(), err
}

// UpdateGroup never locks collections; collection operations lock their group after the collection.
func (r *Repository) UpdateGroup(ctx context.Context, change document.GroupChange) (document.Group, error) {
	var row groupRow
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := wsstore.RequireLocked(ctx, tx, change.Scope.WorkspaceID, change.Scope.ActorID, workspace.Edit); err != nil {
			return err
		}
		var err error
		row, err = groupFor(tx, change.Scope.WorkspaceID, &change.GroupID, "NO KEY UPDATE", false)
		if err != nil {
			return err
		}
		if row.Version != change.ExpectedVersion {
			return versionConflict("GROUP_VERSION_CONFLICT", "分组已变化，请刷新后重试", change.ExpectedVersion, row.Version)
		}
		if row.Version >= document.MaxVersion {
			return fault.New(fault.Conflict, "GROUP_VERSION_EXHAUSTED", "分组版本号已达到上限")
		}
		if change.Archived != nil && *change.Archived && row.IsDefault {
			return fault.New(fault.Conflict, "DEFAULT_GROUP_ARCHIVE_FORBIDDEN", "默认分组不能归档")
		}
		if row.IsArchived && (change.Name != nil || change.SortOrder != nil) {
			return fault.New(fault.Conflict, "GROUP_ARCHIVED", "请先恢复分组再修改")
		}
		if change.Name != nil {
			row.Name = *change.Name
		}
		if change.SortOrder != nil {
			row.SortOrder = *change.SortOrder
		}
		if change.Archived != nil && *change.Archived != row.IsArchived {
			row.IsArchived = *change.Archived
			row.ArchivedAtMS = nil
			if *change.Archived {
				row.ArchivedAtMS = &change.Timestamp
			}
		}
		row.Version++
		row.UpdatedAtMS = change.Timestamp
		return tx.Model(&groupRow{}).Where("id = ?", row.ID).Updates(map[string]any{
			"name":           row.Name,
			"sort_order":     row.SortOrder,
			"version":        row.Version,
			"archived_at_ms": row.ArchivedAtMS, "is_archived": row.IsArchived,
			"updated_at_ms": row.UpdatedAtMS,
		}).Error
	})
	return row.domain(), err
}

func (r *Repository) UpdateCollection(ctx context.Context, change document.CollectionChange) (document.Collection, error) {
	var row collectionRow
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := wsstore.RequireLocked(ctx, tx, change.Scope.WorkspaceID, change.Scope.ActorID, workspace.Edit); err != nil {
			return err
		}
		var err error
		row, err = collectionFor(tx, change.Scope, "NO KEY UPDATE", true)
		if err != nil {
			return err
		}
		if row.MetadataVersion != change.ExpectedVersion {
			return versionConflict("COLLECTION_VERSION_CONFLICT", "文集信息已变化，请刷新后重试", change.ExpectedVersion, row.MetadataVersion)
		}
		if row.MetadataVersion >= document.MaxVersion {
			return fault.New(fault.Conflict, "COLLECTION_VERSION_EXHAUSTED", "文集信息版本号已达到上限")
		}
		if change.GroupSet {
			target, err := groupFor(tx, row.WorkspaceID, change.GroupID, "SHARE", true)
			if err != nil {
				return err
			}
			row.GroupID = target.ID
		}
		if change.Title != nil {
			row.Title = *change.Title
		}
		if change.SortOrder != nil {
			row.SortOrder = *change.SortOrder
		}
		if change.IconSet {
			if err := requireIcon(ctx, tx, row.WorkspaceID, change.Icon); err != nil {
				return err
			}
			row.Icon = change.Icon
		}
		row.MetadataVersion++
		row.UpdatedAtMS = change.Timestamp
		encodedIcon, err := json.Marshal(row.Icon)
		if err != nil {
			return err
		}
		var iconValue any
		if row.Icon != nil {
			iconValue = gorm.Expr("CAST(? AS JSONB)", string(encodedIcon))
		}
		return tx.Model(&collectionRow{}).Where("id = ?", row.ID).Updates(map[string]any{
			"icon":             iconValue,
			"title":            row.Title,
			"group_id":         row.GroupID,
			"sort_order":       row.SortOrder,
			"metadata_version": row.MetadataVersion,
			"updated_at_ms":    row.UpdatedAtMS,
		}).Error
	})
	return row.domain(), err
}
