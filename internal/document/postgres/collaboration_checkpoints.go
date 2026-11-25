package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	collaborationCheckpointBytes = 1 << 20
	collaborationCheckpointCount = 32
	collaborationCheckpointAge   = 5 * time.Second
	collaborationCheckpointLease = 30 * time.Second
)

type collaborationCheckpointClaim struct {
	DocumentID, Epoch    string
	ContentVersion       int64
	SnapshotLeaseUntilMS int64
}

// CompactNextCollaborationSnapshot attempts one due checkpoint, ordered by
// accumulated bytes, update count, and then time. A lease backs off failed
// documents and makes interrupted work retryable by another worker.
func (r *Repository) CompactNextCollaborationSnapshot(ctx context.Context, now int64) (bool, error) {
	if r.collaboration == nil {
		return false, nil
	}
	claim, err := r.claimCollaborationCheckpoint(ctx, now)
	if err != nil {
		return false, fmt.Errorf("claim collaboration checkpoint: %w", err)
	}
	if claim.DocumentID == "" {
		return false, nil
	}
	if err := r.compactCollaborationCheckpoint(ctx, claim); err != nil {
		return true, fmt.Errorf("compact collaboration checkpoint for document %s: %w", claim.DocumentID, err)
	}
	return true, nil
}

func (r *Repository) claimCollaborationCheckpoint(ctx context.Context, now int64) (collaborationCheckpointClaim, error) {
	var claim collaborationCheckpointClaim
	err := r.db.WithContext(ctx).Raw(`
		WITH next_checkpoint AS (
			SELECT document_id
			FROM document_collaboration_states
			WHERE pending_update_count > 0 AND snapshot_lease_until_ms <= ?
			  AND (pending_update_bytes >= ? OR pending_update_count >= ? OR pending_since_ms <= ?)
			ORDER BY CASE WHEN pending_update_bytes >= ? THEN 0
			              WHEN pending_update_count >= ? THEN 1 ELSE 2 END,
			         pending_since_ms, document_id
			LIMIT 1 FOR UPDATE SKIP LOCKED
		)
		UPDATE document_collaboration_states AS s
		SET snapshot_lease_until_ms = ?
		FROM next_checkpoint
		WHERE s.document_id = next_checkpoint.document_id
		RETURNING s.document_id, s.epoch, s.content_version, s.snapshot_lease_until_ms`,
		now, collaborationCheckpointBytes, collaborationCheckpointCount, now-collaborationCheckpointAge.Milliseconds(),
		collaborationCheckpointBytes, collaborationCheckpointCount, now+collaborationCheckpointLease.Milliseconds(),
	).Scan(&claim).Error
	return claim, err
}

func (claim collaborationCheckpointClaim) query(tx *gorm.DB) *gorm.DB {
	return tx.Model(&collaborationRow{}).Where(
		"document_id=? AND epoch=? AND content_version=? AND snapshot_lease_until_ms=?",
		claim.DocumentID, claim.Epoch, claim.ContentVersion, claim.SnapshotLeaseUntilMS,
	)
}

func (r *Repository) compactCollaborationCheckpoint(ctx context.Context, claim collaborationCheckpointClaim) error {
	var row collaborationRow
	var base collaborationBase
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := claim.query(tx).Select(collaborationMetadata).Take(&row).Error; err != nil {
			return err
		}
		var err error
		base, err = r.loadCollaborationBase(ctx, tx, row)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil // A newer checkpoint or epoch superseded the claim.
	}
	if err != nil {
		return fmt.Errorf("read checkpoint and durable updates: %w", err)
	}
	state, err := r.materializeCollaboration(ctx, base)
	if err != nil {
		return fmt.Errorf("rebuild checkpoint: %w", err)
	}
	return r.publishCollaborationCheckpoint(ctx, claim, row, state)
}

func (r *Repository) publishCollaborationCheckpoint(ctx context.Context, claim collaborationCheckpointClaim, merged collaborationRow, state []byte) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Writers take the same checkpoint row lock before changing the
		// logical head. Compaction only advances the checkpoint.
		var current collaborationRow
		err := claim.query(tx).Clauses(clause.Locking{Strength: "UPDATE"}).Select(collaborationMetadata).Take(&current).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		// A writer can append while the worker rebuilds. Publish only the
		// original prefix and keep all newer updates and their head metadata.
		pendingCount := current.PendingUpdateCount - merged.PendingUpdateCount
		pendingBytes := current.PendingUpdateBytes - merged.PendingUpdateBytes
		if pendingCount < 0 || pendingBytes < 0 {
			return errors.New("collaboration checkpoint does not match the durable update head")
		}
		var pendingSinceMS int64
		if pendingCount > 0 {
			var oldest collaborationUpdateRow
			if err := tx.Select("created_at_ms").Where(
				"document_id=? AND epoch=? AND content_version=?", claim.DocumentID, claim.Epoch, merged.headVersion()+1,
			).Take(&oldest).Error; err != nil {
				return fmt.Errorf("read first remaining collaboration update: %w", err)
			}
			pendingSinceMS = oldest.CreatedAtMS
		}
		if err := claim.query(tx).Updates(map[string]any{
			"content_version":         merged.headVersion(),
			"state":                   state,
			"pending_update_count":    pendingCount,
			"pending_update_bytes":    pendingBytes,
			"pending_since_ms":        pendingSinceMS,
			"snapshot_lease_until_ms": 0,
		}).Error; err != nil {
			return err
		}
		pruneThrough := min(merged.headVersion(), current.headVersion()-collaborationRetainedVersions)
		if pruneThrough <= 0 {
			return nil
		}
		return tx.Where("document_id=? AND content_version<=?", claim.DocumentID, pruneThrough).Delete(&collaborationUpdateRow{}).Error
	})
}
