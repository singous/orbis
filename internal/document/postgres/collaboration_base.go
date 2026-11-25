package postgres

import (
	"bytes"
	"container/list"
	"context"
	"fmt"
	"strconv"
	"sync"

	"golang.org/x/sync/singleflight"
	"gorm.io/gorm"
	"orbis.local/orbis/internal/document"
)

const (
	maxCollaborationReplayBytes   = 4 << 20
	maxCollaborationReplayUpdates = 96
	maxCollaborationCacheBytes    = 64 << 20
	maxCollaborationCacheEntries  = 32
)

const collaborationMetadata = "document_id,epoch,content_version,state_vector,updated_at_ms,pending_update_count,pending_update_bytes,pending_since_ms"

type collaborationBase struct {
	row      collaborationRow
	snapshot []byte
	replay   [][]byte
}

type cachedCollaborationState struct {
	documentID, epoch string
	version           int64
	binary            []byte
}

// Cache entries are immutable and committed. Callers must first read the
// authorized document head from PostgreSQL and match its exact epoch/version.
type collaborationStateCache struct {
	mu              sync.Mutex
	byDocument      map[string]*list.Element
	usage           int
	recent          list.List
	reconstructions singleflight.Group
}

func (c *collaborationStateCache) get(row collaborationRow) []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry := c.byDocument[row.DocumentID]
	if entry == nil {
		return nil
	}
	state := entry.Value.(cachedCollaborationState)
	if state.epoch != row.Epoch || state.version != row.headVersion() {
		return nil
	}
	c.recent.MoveToFront(entry)
	return state.binary
}

func (c *collaborationStateCache) put(id, epoch string, version int64, state []byte) {
	if len(state) == 0 || len(state) > maxCollaborationCacheBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.byDocument == nil {
		c.byDocument = make(map[string]*list.Element)
	}
	if existing := c.byDocument[id]; existing != nil {
		previous := existing.Value.(cachedCollaborationState)
		if previous.version > version {
			return
		}
		c.recent.Remove(existing)
		c.usage -= len(previous.binary)
	}
	c.byDocument[id] = c.recent.PushFront(cachedCollaborationState{id, epoch, version, state})
	c.usage += len(state)
	for c.usage > maxCollaborationCacheBytes || c.recent.Len() > maxCollaborationCacheEntries {
		evicted := c.recent.Remove(c.recent.Back()).(cachedCollaborationState)
		delete(c.byDocument, evicted.documentID)
		c.usage -= len(evicted.binary)
	}
}

// The caller reads metadata, checkpoint and its retained tail in a repeatable
// read transaction or while holding the collaboration row write lock.
func loadCollaborationBase(ctx context.Context, tx *gorm.DB, row collaborationRow) (collaborationBase, error) {
	base := collaborationBase{row: row, snapshot: row.State}
	if len(base.snapshot) == 0 {
		var stored struct{ State []byte }
		if err := tx.WithContext(ctx).Table(row.TableName()).Select("state").
			Where("document_id=? AND epoch=? AND content_version=?", row.DocumentID, row.Epoch, row.ContentVersion).
			Take(&stored).Error; err != nil {
			return base, err
		}
		base.snapshot = stored.State
	}
	if row.PendingUpdateCount == 0 {
		return base, nil
	}
	if row.PendingUpdateCount < 0 || row.PendingUpdateCount > maxCollaborationReplayUpdates ||
		row.PendingUpdateBytes <= 0 || row.PendingUpdateBytes > maxCollaborationReplayBytes {
		return base, fmt.Errorf("collaboration replay exceeds its persisted budget")
	}

	var tail []collaborationUpdateRow
	if err := tx.WithContext(ctx).Select("content_version,update_data").
		Where("document_id=? AND epoch=? AND content_version>? AND content_version<=?", row.DocumentID, row.Epoch, row.ContentVersion, row.headVersion()).
		Order("content_version,operation_id").Limit(int(row.PendingUpdateCount) + 1).Find(&tail).Error; err != nil {
		return base, err
	}
	if int64(len(tail)) != row.PendingUpdateCount {
		return base, fmt.Errorf("collaboration replay history has missing or duplicate updates")
	}
	base.replay = make([][]byte, 0, len(tail))
	var size int64
	for i, update := range tail {
		if update.ContentVersion != row.ContentVersion+int64(i)+1 || len(update.Update) == 0 {
			return base, fmt.Errorf("collaboration replay history is not continuous")
		}
		size += int64(len(update.Update))
		base.replay = append(base.replay, update.Update)
	}
	if size != row.PendingUpdateBytes {
		return base, fmt.Errorf("collaboration replay byte count does not match the persisted budget")
	}
	return base, nil
}

func (r *Repository) loadCollaborationBase(ctx context.Context, tx *gorm.DB, row collaborationRow) (collaborationBase, error) {
	if current := r.collaborationCache.get(row); current != nil {
		return collaborationBase{row: row, snapshot: current}, nil
	}
	return loadCollaborationBase(ctx, tx, row)
}

func materializeCollaboration(ctx context.Context, engine document.CollaborationEngine, base collaborationBase) ([]byte, error) {
	if len(base.replay) == 0 {
		return base.snapshot, nil
	}
	result, err := engine.Transform(ctx, document.CollaborationTransform{State: base.snapshot, Replay: base.replay})
	if err != nil {
		return nil, err
	}
	if len(result.State) == 0 || !bytes.Equal(result.StateVector, base.row.StateVector) {
		return nil, fmt.Errorf("collaboration replay does not match the committed state vector")
	}
	return result.State, nil
}

func (r *Repository) materializeCollaboration(ctx context.Context, base collaborationBase) ([]byte, error) {
	row := base.row
	if len(base.replay) == 0 {
		return base.snapshot, nil
	}
	key := row.DocumentID + ":" + row.Epoch + ":" + strconv.FormatInt(row.headVersion(), 10)
	result := r.collaborationCache.reconstructions.DoChan(key, func() (any, error) {
		if cached := r.collaborationCache.get(row); cached != nil {
			return cached, nil
		}
		state, err := materializeCollaboration(ctx, r.collaboration, base)
		if err != nil {
			return nil, err
		}
		r.collaborationCache.put(row.DocumentID, row.Epoch, row.headVersion(), state)
		return state, nil
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case resolved := <-result:
		if resolved.Err != nil {
			return nil, resolved.Err
		}
		return resolved.Val.([]byte), nil
	}
}
