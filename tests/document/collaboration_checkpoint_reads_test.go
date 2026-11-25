//go:build integration

package document_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/tests/testenv"
)

func TestCollaborationCommitsTailBeforeCheckpointAndColdOpensDuringSaveLock(t *testing.T) {
	f, engine, blocks, initial := collaborationFixture(t)
	blocks[0].Content[0].Text = "Recovered from committed journal"
	route := f.path + "/collaboration"
	update := generatedUpdate(t, engine, initial, blocks)
	saved := testenv.Decode[document.CollaborationResult](t, f.env.Call(t, "POST", route+"/updates", f.session.AccessToken, update, 200))
	if !saved.Changed || saved.ContentVersion != initial.ContentVersion+1 {
		t.Fatalf("increment did not advance the committed head: %+v", saved)
	}
	var stored struct {
		ContentVersion     int64
		PendingUpdateCount int64
		PendingUpdateBytes int64
		State              []byte
	}
	if err := f.env.DB.Table("document_collaboration_states").Where("document_id=?", f.documentID).Take(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.ContentVersion != initial.ContentVersion || !bytes.Equal(stored.State, initial.State) ||
		stored.PendingUpdateCount != 1 || stored.PendingUpdateBytes != int64(len(update.Update)) {
		t.Fatalf("save unexpectedly rewrote the checkpoint or lost its tail: version=%d count=%d bytes=%d", stored.ContentVersion, stored.PendingUpdateCount, stored.PendingUpdateBytes)
	}
	// Start the HTTP app with an empty in-memory state cache and hold the
	// document row to exercise a true cold open during a pending write lock.
	f.env.RestartApplication(t)
	locked := f.env.DB.Begin()
	if locked.Error != nil {
		t.Fatal(locked.Error)
	}
	defer locked.Rollback()
	if err := locked.Exec("SELECT id FROM documents WHERE id=? FOR UPDATE", f.documentID).Error; err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	request := httptest.NewRequestWithContext(ctx, http.MethodPost, route, nil)
	request.Header.Set("Authorization", "Bearer "+f.session.AccessToken)
	wire, err := f.env.DoRequest(request)
	if err != nil || wire.Status != http.StatusOK {
		t.Fatalf("cold opening an initialized document should bypass the write lock: status %d, %v", wire.Status, err)
	}
	opened := testenv.Decode[document.CollaborationState](t, wire)
	projected, err := engine.Transform(t.Context(), document.CollaborationTransform{State: opened.State})
	if err != nil || opened.ContentVersion != saved.ContentVersion || !document.EquivalentCollaborationBlocks(projected.Blocks, blocks) {
		t.Fatalf("cold opening did not reconstruct the committed document: %v", err)
	}
	if err := locked.Rollback().Error; err != nil {
		t.Fatal(err)
	}

	// The same Yjs update under another operation ID is still a no-op
	// against the full committed head, even while its checkpoint is old.
	update.OperationID = uuid.NewString()
	retry := testenv.Decode[document.CollaborationResult](t, f.env.Call(t, "POST", route+"/updates", f.session.AccessToken, update, 200))
	if retry.Changed || retry.ContentVersion != saved.ContentVersion {
		t.Fatalf("redundant update advanced the committed head: %+v", retry)
	}
}

func TestCollaborationRejectsColdReadWhenTheDurableTailHasAGap(t *testing.T) {
	f, engine, blocks, initial := collaborationFixture(t)
	blocks[0].Content[0].Text = "Still committed in the native projection"
	update := generatedUpdate(t, engine, initial, blocks)
	f.env.Call(t, "POST", f.path+"/collaboration/updates", f.session.AccessToken, update, 200)
	if err := f.env.DB.Exec("DELETE FROM document_collaboration_updates WHERE document_id=? AND operation_id=?", f.documentID, update.OperationID).Error; err != nil {
		t.Fatal(err)
	}
	scope := document.DirectoryScope{ActorID: f.session.User.ID, WorkspaceID: f.workspaceID, DocumentID: f.documentID}
	fresh := docstore.NewWithCollaboration(f.env.DB, engine)
	if _, _, err := fresh.ReadCollaboration(t.Context(), scope, 0); err == nil {
		t.Fatal("a missing durable update must not look like a successful cold read")
	}
}

func TestCollaborationBoundsReplayWhenTheWorkerIsStopped(t *testing.T) {
	f, engine, blocks, initial := collaborationFixture(t)
	head := initial
	for range 96 {
		head = saveCheckpointEdit(t, f, engine, head, blocks, "x")
	}
	pending := readCheckpointMetadata(t, f)
	if pending.ContentVersion != initial.ContentVersion || pending.PendingUpdateCount != 96 {
		t.Fatalf("expected a bounded tail before the hard limit, got %+v", pending)
	}
	head = saveCheckpointEdit(t, f, engine, head, blocks, "y")
	if got := readCheckpointMetadata(t, f); got != (checkpointMetadata{ContentVersion: head.ContentVersion}) {
		t.Fatalf("the next save should persist its snapshot and clear the replay budget: %+v", got)
	}
	f.env.RestartApplication(t)
	recovered := readCollaboration(t, f)
	if !bytes.Equal(head.State, recovered.State) || recovered.ContentVersion != head.ContentVersion {
		t.Fatal("restart after a synchronous checkpoint lost committed content")
	}
}
