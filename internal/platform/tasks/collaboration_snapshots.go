package tasks

import (
	"context"
	"log/slog"
	"time"

	"orbis.local/orbis/internal/platform/clock"
)

const (
	collaborationSnapshotInterval = time.Second
	collaborationSnapshotTimeout  = 20 * time.Second
	collaborationSnapshotBatch    = 4
)

type CollaborationSnapshotRepository interface {
	CompactNextCollaborationSnapshot(context.Context, int64) (bool, error)
}

type CollaborationSnapshots struct {
	cancel context.CancelFunc
	done   chan struct{}
}

// StartCollaborationSnapshots runs one compaction at a time against the
// durable PostgreSQL queue. Close owns cancellation and joins the worker.
func StartCollaborationSnapshots(ctx context.Context, repo CollaborationSnapshotRepository, c clock.Clock, logger *slog.Logger) *CollaborationSnapshots {
	owner, cancel := context.WithCancel(context.WithoutCancel(ctx))
	worker := &CollaborationSnapshots{cancel: cancel, done: make(chan struct{})}
	go func() {
		defer close(worker.done)
		ticker := time.NewTicker(collaborationSnapshotInterval)
		defer ticker.Stop()
		for owner.Err() == nil {
			for range collaborationSnapshotBatch {
				task, cancel := context.WithTimeout(owner, collaborationSnapshotTimeout)
				attempted, err := repo.CompactNextCollaborationSnapshot(task, c.Now().UnixMilli())
				cancel()
				if owner.Err() != nil {
					return
				}
				if err != nil {
					logger.WarnContext(owner, "collaboration checkpoint deferred", "error", err)
				}
				if !attempted {
					break
				}
			}
			select {
			case <-owner.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return worker
}

func (w *CollaborationSnapshots) Close() {
	if w == nil {
		return
	}
	w.cancel()
	<-w.done
}
