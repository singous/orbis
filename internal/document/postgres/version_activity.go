package postgres

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"orbis.local/orbis/internal/document"
)

type versionActivityRow struct {
	DocumentID     string
	SourceRevision int64
	StartedAtMS    int64 `gorm:"column:started_at_ms"`
	TouchedAtMS    int64 `gorm:"column:touched_at_ms"`
	CheckedAtMS    int64 `gorm:"column:checked_at_ms"`
}

func (versionActivityRow) TableName() string { return "document_version_activity" }

const versionDispatchBatch = 50

// DueVersions returns a bounded fair batch. The outbox survives queue loss and restarts.
func (r *Repository) DueVersions(ctx context.Context, now int64) ([]string, error) {
	ids := []string{}
	err := r.db.WithContext(ctx).Model(&versionActivityRow{}).Where("touched_at_ms<=? OR started_at_ms<=?", now-document.VersionIdleInterval.Milliseconds(), now-document.VersionMaximumInterval.Milliseconds()).Order("checked_at_ms,document_id").Limit(versionDispatchBatch).Pluck("document_id", &ids).Error
	return ids, err
}

func (r *Repository) VersionDispatched(ctx context.Context, id string, now int64) error {
	return r.db.WithContext(ctx).Model(&versionActivityRow{}).Where("document_id=?", id).Update("checked_at_ms", now).Error
}

// CaptureAutomatic locks in writer order and consumes only the exact pending activity it captures.
func (r *Repository) CaptureAutomatic(ctx context.Context, id string, now int64) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var doc documentRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=?", id).Take(&doc).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		var activity versionActivityRow
		if err := tx.Where("document_id=?", id).Take(&activity).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if activity.TouchedAtMS > now-document.VersionIdleInterval.Milliseconds() && activity.StartedAtMS > now-document.VersionMaximumInterval.Milliseconds() {
			return nil
		}
		if _, err := captureVersion(ctx, tx, id, activity.SourceRevision, document.VersionKindAutomatic, nil, "", nil, now); err != nil {
			return err
		}
		return tx.Where("document_id=?", id).Delete(&versionActivityRow{}).Error
	})
}
