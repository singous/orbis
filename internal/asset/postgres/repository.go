package postgres

import (
	"context"
	"database/sql"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type Repository struct {
	db    *gorm.DB
	clock clock.Clock
}

func New(db *gorm.DB, clock clock.Clock) *Repository { return &Repository{db: db, clock: clock} }

type Record struct {
	ID, OwnerID                                          string
	WorkspaceID                                          *string
	Kind, State, StorageKey, Filename, MediaType, SHA256 string
	SizeBytes                                            int64
	CreatedAtMS                                          int64  `gorm:"column:created_at_ms"`
	UpdatedAtMS                                          int64  `gorm:"column:updated_at_ms"`
	RetiredAtMS                                          *int64 `gorm:"column:retired_at_ms"`
}

func (Record) TableName() string { return "assets" }
func (r Record) Domain() asset.Record {
	return asset.Record{
		ID:          r.ID,
		OwnerID:     r.OwnerID,
		WorkspaceID: r.WorkspaceID,
		Kind:        r.Kind,
		State:       r.State,
		StorageKey:  r.StorageKey,
		Filename:    r.Filename,
		MediaType:   r.MediaType,
		SHA256:      r.SHA256,
		SizeBytes:   r.SizeBytes,
		CreatedAtMS: r.CreatedAtMS,
		UpdatedAtMS: r.UpdatedAtMS,
		RetiredAtMS: r.RetiredAtMS,
	}
}
func missing(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fault.Missing()
	}
	return err
}
func (r *Repository) Begin(ctx context.Context, input asset.Record) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if input.WorkspaceID != nil {
			if err := wsstore.RequireLocked(ctx, tx, *input.WorkspaceID, input.OwnerID, workspace.Edit); err != nil {
				return err
			}
		}
		return tx.Create(&Record{
			ID:          input.ID,
			OwnerID:     input.OwnerID,
			WorkspaceID: input.WorkspaceID,
			Kind:        input.Kind,
			State:       "staging",
			StorageKey:  input.StorageKey,
			Filename:    input.Filename,
			MediaType:   input.MediaType,
			CreatedAtMS: input.CreatedAtMS,
			UpdatedAtMS: input.UpdatedAtMS,
		}).Error
	})
}

// PublishInTransaction keeps the upload record locked across storage I/O and final metadata publication.
func PublishInTransaction(ctx context.Context, tx *gorm.DB, clock clock.Clock, actor, id, kind string, wid *string, write asset.WriteObject) (asset.Record, error) {
	var row Record
	q := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND owner_id=? AND kind=? AND state='staging'", id, actor, kind)
	if wid != nil {
		q = q.Where("workspace_id=?", *wid)
	} else {
		q = q.Where("workspace_id IS NULL")
	}
	if err := q.Take(&row).Error; err != nil {
		return asset.Record{}, missing(err)
	}
	if row.CreatedAtMS <= clock.Now().Add(-asset.Retention).UnixMilli() {
		return asset.Record{}, fault.New(fault.Conflict, "UPLOAD_EXPIRED", "上传已过期，请重新上传")
	}
	metadata, err := write(ctx)
	if err != nil {
		return asset.Record{}, err
	}
	row.State = "ready"
	row.SizeBytes = metadata.SizeBytes
	row.SHA256 = metadata.SHA256
	row.MediaType = metadata.MediaType
	row.UpdatedAtMS = clock.Now().UnixMilli()
	err = tx.Model(&Record{}).Where("id=?", row.ID).Updates(
		map[string]any{"state": row.State, "size_bytes": row.SizeBytes, "sha256": row.SHA256, "media_type": row.MediaType, "updated_at_ms": row.UpdatedAtMS},
	).Error
	return row.Domain(), err
}
func (r *Repository) PublishFile(ctx context.Context, scope asset.Scope, id string, write asset.WriteObject) (asset.Record, error) {
	var result asset.Record
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Edit); err != nil {
			return err
		}
		var err error
		result, err = PublishInTransaction(
			ctx,
			tx,
			r.clock,
			scope.ActorID,
			id,
			"file",
			&scope.WorkspaceID,
			write,
		)
		return err
	})
	return result, err
}
func (r *Repository) File(ctx context.Context, scope asset.Scope, id string) (asset.Record, error) {
	var row Record
	err := r.db.WithContext(ctx).Where("id=? AND workspace_id=? AND kind='file' AND state='ready'", id, scope.WorkspaceID).Take(&row).Error
	return row.Domain(), missing(err)
}
func (r *Repository) List(ctx context.Context, scope asset.Scope, page pagination.Page) ([]asset.Record, int64, error) {
	items := []asset.Record{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		q := tx.Model(&Record{}).Where("workspace_id=? AND owner_id=? AND kind='file' AND state='ready'", scope.WorkspaceID, scope.ActorID)
		if err := q.Count(&total).Error; err != nil {
			return err
		}
		var rows []Record
		if err := q.Order("created_at_ms DESC,id DESC").Offset(page.Offset()).Limit(page.Size).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			items = append(items, row.Domain())
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return items, total, err
}
func RetireAvatar(ctx context.Context, tx *gorm.DB, actor string, id *string, now int64) error {
	if id == nil {
		return nil
	}
	return tx.WithContext(ctx).Model(&Record{}).Where("id=? AND owner_id=? AND kind='avatar' AND state='ready'", *id, actor).Updates(
		map[string]any{"state": "obsolete", "retired_at_ms": now, "updated_at_ms": now},
	).Error
}

// Cleanup first commits tombstones, then removes only unreachable objects. Failed deletion is retryable.
func (r *Repository) Cleanup(ctx context.Context, remove func(context.Context, string) error) (int, error) {
	cutoff := r.clock.Now().Add(-asset.Retention).UnixMilli()
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var expired []Record
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Where("state='staging' AND created_at_ms<=?", cutoff).Order("created_at_ms,id").Limit(asset.CleanupBatch).Find(
			&expired,
		).Error; err != nil {
			return err
		}
		for _, row := range expired {
			now := r.clock.Now().UnixMilli()
			if err := tx.Model(&Record{}).Where("id=?", row.ID).Updates(map[string]any{"state": "abandoned", "retired_at_ms": now, "updated_at_ms": now}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	count := 0
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rows []Record
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).Where("state='abandoned' OR (state='obsolete' AND retired_at_ms<=?)", cutoff).Order("retired_at_ms,id").Limit(
			asset.CleanupBatch,
		).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			if err := remove(ctx, row.StorageKey); err != nil {
				return err
			}
			if err := tx.Model(&Record{}).Where("id=?", row.ID).Updates(map[string]any{"state": "purged", "updated_at_ms": r.clock.Now().UnixMilli()}).Error; err != nil {
				return err
			}
			count++
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return count, nil
}
