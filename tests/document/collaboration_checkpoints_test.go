//go:build integration

package document_test

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/crdtengine"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/tests/testenv"
)

type checkpointMetadata struct {
	ContentVersion, PendingUpdateCount, PendingUpdateBytes, PendingSinceMS, SnapshotLeaseUntilMS int64
}

func readCheckpointMetadata(t *testing.T, f fixture) checkpointMetadata {
	t.Helper()
	var row checkpointMetadata
	if err := f.env.DB.Table("document_collaboration_states").Select(
		"content_version,pending_update_count,pending_update_bytes,pending_since_ms,snapshot_lease_until_ms",
	).Where("document_id=?", f.documentID).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	return row
}

func addCheckpointFixture(t *testing.T, f fixture) (fixture, []document.Block, document.CollaborationState) {
	t.Helper()
	root := "/api/v1/workspaces/" + f.workspaceID
	row := testenv.Decode[struct{ ID string }](t, f.env.Call(t, http.MethodPost,
		root+"/collections/"+f.collectionID+"/documents", f.session.AccessToken, map[string]any{"title": "Checkpoint fixture"}, http.StatusCreated))
	f.documentID = row.ID
	f.path = root + "/documents/" + row.ID
	blocks := []document.Block{block("Base")}
	f.env.Call(t, http.MethodPut, f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Checkpoint fixture", blocks), http.StatusOK)
	state := testenv.Decode[document.CollaborationState](t, f.env.Call(t, http.MethodPost,
		f.path+"/collaboration", f.session.AccessToken, nil, http.StatusOK))
	return f, blocks, state
}

func saveCheckpointEdit(t *testing.T, f fixture, engine *crdtengine.Client, state document.CollaborationState, blocks []document.Block, suffix string) document.CollaborationState {
	t.Helper()
	blocks[0].Content[0].Text += suffix
	update := generatedUpdate(t, engine, state, blocks)
	f.env.Call(t, http.MethodPost, f.path+"/collaboration/updates", f.session.AccessToken, update, http.StatusOK)
	return readCollaboration(t, f)
}

func TestCollaborationCheckpointPriority(t *testing.T) {
	aged, engine, blocks, state := collaborationFixture(t)
	saveCheckpointEdit(t, aged, engine, state, blocks, " aged")
	repo := docstore.NewWithCollaboration(aged.env.DB, engine)
	if ran, err := repo.CompactNextCollaborationSnapshot(t.Context(), aged.env.Clock.Now().UnixMilli()); err != nil || ran {
		t.Fatalf("one fresh update should not be due: attempted=%t err=%v", ran, err)
	}
	aged.env.Clock.Advance(5 * time.Second)
	counted, countBlocks, countState := addCheckpointFixture(t, aged)
	for range 32 {
		countState = saveCheckpointEdit(t, counted, engine, countState, countBlocks, "a")
	}
	large, largeBlocks, largeState := addCheckpointFixture(t, aged)
	saveCheckpointEdit(t, large, engine, largeState, largeBlocks, strings.Repeat("b", 1<<20))
	fixtures := []fixture{large, counted, aged}
	for i, f := range fixtures {
		if ran, err := repo.CompactNextCollaborationSnapshot(t.Context(), f.env.Clock.Now().UnixMilli()); err != nil || !ran {
			t.Fatalf("due checkpoint %d: attempted=%t err=%v", i, ran, err)
		}
		got := readCheckpointMetadata(t, f)
		if got != (checkpointMetadata{ContentVersion: readCollaboration(t, f).ContentVersion}) {
			t.Fatalf("due checkpoint %d did not drain: %+v", i, got)
		}
		for _, waiting := range fixtures[i+1:] {
			if readCheckpointMetadata(t, waiting).PendingUpdateCount == 0 {
				t.Fatal("a lower-priority checkpoint was selected early")
			}
		}
	}
}

type blockedCheckpointEngine struct {
	document.CollaborationEngine
	started, resume chan struct{}
}

func (e blockedCheckpointEngine) Transform(ctx context.Context, input document.CollaborationTransform) (document.CollaborationTransformResult, error) {
	if len(input.Replay) > 0 {
		close(e.started)
		select {
		case <-e.resume:
		case <-ctx.Done():
			return document.CollaborationTransformResult{}, ctx.Err()
		}
	}
	return e.CollaborationEngine.Transform(ctx, input)
}

func TestCollaborationCheckpointKeepsNewerCommitAndAllowsRestart(t *testing.T) {
	f, engine, blocks, state := collaborationFixture(t)
	prefix := saveCheckpointEdit(t, f, engine, state, blocks, " prefix")
	f.env.Clock.Advance(5 * time.Second)
	blocked := blockedCheckpointEngine{CollaborationEngine: engine, started: make(chan struct{}), resume: make(chan struct{})}
	repo := docstore.NewWithCollaboration(f.env.DB, blocked)
	peer := docstore.NewWithCollaboration(f.env.DB, engine)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(blocked.resume) }) }
	defer release()
	done := make(chan error, 1)
	go func() {
		ran, err := repo.CompactNextCollaborationSnapshot(ctx, f.env.Clock.Now().UnixMilli())
		if !ran && err == nil {
			err = errors.New("worker did not claim a due snapshot")
		}
		done <- err
	}()
	select {
	case <-blocked.started:
	case err := <-done:
		t.Fatalf("checkpoint did not start replay: %v", err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if ran, err := peer.CompactNextCollaborationSnapshot(ctx, f.env.Clock.Now().UnixMilli()); ran || err != nil {
		t.Fatalf("another worker took a live lease: attempted=%t err=%v", ran, err)
	}
	latest := saveCheckpointEdit(t, f, engine, prefix, blocks, " next")
	release()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	row := readCheckpointMetadata(t, f)
	if row.ContentVersion != prefix.ContentVersion || row.PendingUpdateCount != 1 || row.PendingUpdateBytes <= 0 ||
		row.PendingSinceMS != f.env.Clock.Now().UnixMilli() || row.SnapshotLeaseUntilMS != 0 {
		t.Fatalf("compaction did not preserve the newer tail: %+v", row)
	}
	f.env.RestartApplication(t)
	got := readCollaboration(t, f)
	if got.ContentVersion != latest.ContentVersion || !bytes.Equal(got.State, latest.State) ||
		!bytes.Equal(got.StateVector, latest.StateVector) || got.UpdatedAtMS != latest.UpdatedAtMS {
		t.Fatal("restart lost a committed edit or returned stale head metadata")
	}
}

type failingCheckpointEngine struct{ document.CollaborationEngine }

func (e failingCheckpointEngine) Transform(ctx context.Context, input document.CollaborationTransform) (document.CollaborationTransformResult, error) {
	if len(input.Replay) > 0 {
		return document.CollaborationTransformResult{}, errors.New("checkpoint engine unavailable")
	}
	return e.CollaborationEngine.Transform(ctx, input)
}

func TestCollaborationCheckpointRetriesWhenLeaseExpires(t *testing.T) {
	f, engine, blocks, initial := collaborationFixture(t)
	saved := saveCheckpointEdit(t, f, engine, initial, blocks, " pending")
	f.env.Clock.Advance(5 * time.Second)
	failed := docstore.NewWithCollaboration(f.env.DB, failingCheckpointEngine{engine})
	now := f.env.Clock.Now().UnixMilli()
	if ran, err := failed.CompactNextCollaborationSnapshot(t.Context(), now); !ran || err == nil {
		t.Fatalf("expected a failed checkpoint attempt: attempted=%t err=%v", ran, err)
	}
	unmerged := readCheckpointMetadata(t, f)
	if unmerged.ContentVersion != initial.ContentVersion || unmerged.PendingUpdateCount != 1 || unmerged.SnapshotLeaseUntilMS <= now {
		t.Fatalf("failed checkpoint changed the durable state: %+v", unmerged)
	}
	retry := docstore.NewWithCollaboration(f.env.DB, engine)
	if ran, err := retry.CompactNextCollaborationSnapshot(t.Context(), unmerged.SnapshotLeaseUntilMS-1); ran || err != nil {
		t.Fatalf("expected retry to honor the lease: attempted=%t err=%v", ran, err)
	}
	if ran, err := retry.CompactNextCollaborationSnapshot(t.Context(), unmerged.SnapshotLeaseUntilMS); !ran || err != nil {
		t.Fatalf("expected retry at lease expiry: attempted=%t err=%v", ran, err)
	}
	if row := readCheckpointMetadata(t, f); row != (checkpointMetadata{ContentVersion: saved.ContentVersion}) {
		t.Fatalf("retry did not publish the saved revision: %+v", row)
	}
}
