//go:build integration

package document_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/crdtengine"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/table"
	"orbis.local/orbis/tests/testenv"
)

type delayedCollaborationEngine struct {
	engine           document.CollaborationEngine
	once             sync.Once
	started, release chan struct{}
}

func (e *delayedCollaborationEngine) Transform(ctx context.Context, input document.CollaborationTransform) (document.CollaborationTransformResult, error) {
	blocked := false
	if input.Update != nil {
		e.once.Do(func() { blocked = true; close(e.started) })
	}
	if blocked {
		select {
		case <-e.release:
		case <-ctx.Done():
			return document.CollaborationTransformResult{}, ctx.Err()
		}
	}
	return e.engine.Transform(ctx, input)
}

func TestCollaborationPreparationReleasesLocksAndMergesAnInterveningCommit(t *testing.T) {
	f, engine, blocks, baseline := collaborationFixtureWithBlocks(t, []document.Block{block("Left"), block("Right")})
	changed := copyBlocks(t, blocks)
	changed[0].Content[0].Text = "Left prepared"
	update := generatedUpdate(t, engine, baseline, changed)
	delayed := &delayedCollaborationEngine{engine: engine, started: make(chan struct{}), release: make(chan struct{})}
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(delayed.release) }) }
	defer release()
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	repository := docstore.NewWithCollaboration(f.env.DB, delayed)
	finished := make(chan error, 1)
	go func() {
		_, err := repository.CommitCollaboration(ctx, document.CollaborationCommit{Scope: document.DirectoryScope{ActorID: f.session.User.ID, WorkspaceID: f.workspaceID, DocumentID: f.documentID}, Input: update, RequestHash: "synthetic-prepared-update", Timestamp: f.env.Clock.Now().UnixMilli()})
		finished <- err
	}()
	select {
	case <-delayed.started:
	case <-ctx.Done():
		t.Fatal("conversion did not start")
	}
	// This writer must complete while the first engine invocation is still blocked.
	f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: baseline.ContentVersion, Operations: []document.Operation{{Type: "replace_text", BlockID: blocks[1].ID, Match: "Right", Replacement: "Right peer"}}}, 200)
	release()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("prepared update did not finish")
	}
	current := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200))
	if current.Blocks[0].Content[0].Text != "Left prepared" || current.Blocks[1].Content[0].Text != "Right peer" {
		t.Fatal("stale preparation overwrote a peer or rejected a mergeable update")
	}
}

func collaborationFixture(t *testing.T) (fixture, *crdtengine.Client, []document.Block, document.CollaborationState) {
	t.Helper()
	return collaborationFixtureWithBlocks(t, []document.Block{block("Base"), block("Unrelated")})
}
func collaborationFixtureWithBlocks(t *testing.T, blocks []document.Block) (fixture, *crdtengine.Client, []document.Block, document.CollaborationState) {
	t.Helper()
	f := newDocumentWithEnvironment(t, testenv.NewWithCollaboration(t))
	engine, err := crdtengine.New(os.Getenv("ORBIS_TEST_COLLABORATION_URL"), os.Getenv("ORBIS_TEST_COLLABORATION_KEY"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(engine.Close)
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Initial", blocks), 200)
	state := testenv.Decode[document.CollaborationState](t, f.env.Call(t, "POST", f.path+"/collaboration", f.session.AccessToken, nil, 200))
	return f, engine, blocks, state
}

func TestCollaborationPreservesUntouchedNativeRunsAndBlockRevision(t *testing.T) {
	href, textColor, backgroundColor := "https://example.test/retained", "#aabbcc", "#ddeeff"
	initial := []document.Block{block(""), block("Other paragraph")}
	initial[0].Content = []document.TextRun{
		{Text: "Untouched ", Marks: []string{"italic", "bold"}, Href: &href, TextColor: &textColor, BackgroundColor: &backgroundColor},
		{Text: "paragraph", Marks: []string{"bold", "italic"}, Href: &href, TextColor: &textColor, BackgroundColor: &backgroundColor},
	}
	f, engine, original, baseline := collaborationFixtureWithBlocks(t, initial)
	projected, err := engine.Transform(t.Context(), document.CollaborationTransform{State: baseline.State})
	if err != nil {
		t.Fatal(err)
	}
	if len(projected.Blocks[0].Content) != 1 || projected.Blocks[0].Content[0].Text != "Untouched paragraph" {
		t.Fatal("fixture did not exercise cache-free run coalescing")
	}
	if !document.EquivalentCollaborationBlocks(original, projected.Blocks) {
		t.Fatal("binary seed changed the native content meaning")
	}
	changed := copyBlocks(t, projected.Blocks)
	changed[1].Content[0].Text = "Changed independently"
	update := generatedUpdate(t, engine, baseline, changed)
	f.env.Call(t, "POST", f.path+"/collaboration/updates", f.session.AccessToken, update, 200)
	current := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200))
	want, _ := json.Marshal(original[0].Content)
	got, _ := json.Marshal(current.Blocks[0].Content)
	if current.Revision.Version != 3 || !bytes.Equal(got, want) || current.Blocks[1].Content[0].Text != "Changed independently" {
		t.Fatal("editing another block changed the untouched native run boundaries, mark order or formatting")
	}
	window := testenv.Decode[readWindow](t, f.env.Call(t, "GET", f.path+"/children?version=3", f.session.AccessToken, nil, 200))
	if len(window.Items) != 2 || window.Items[0].ID != original[0].ID || window.Items[0].Revision != 2 || window.Items[1].Revision != 3 {
		t.Fatal("run representation changes rewrote an untouched block revision")
	}
	var versions int64
	if err := f.env.DB.Table("document_block_versions").Where("document_id=? AND block_id=?", f.documentID, original[0].ID).Count(&versions).Error; err != nil {
		t.Fatal(err)
	}
	if versions != 1 {
		t.Fatal("run coalescing inserted a redundant native block history row")
	}
	// A native API caller still owns its exact accepted run representation.
	replacement := document.Payload{Type: "paragraph", Props: original[0].Props, Content: []document.TextRun{
		{Text: "Untouch", Marks: []string{"bold", "italic"}, Href: &href, TextColor: &textColor, BackgroundColor: &backgroundColor},
		{Text: "ed paragraph", Marks: []string{"bold", "italic"}, Href: &href, TextColor: &textColor, BackgroundColor: &backgroundColor},
	}}
	command(t, f, 3, document.Operation{Type: "update_block", BlockID: original[0].ID, Block: &replacement})
	afterNative := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200))
	want, _ = json.Marshal(replacement.Content)
	got, _ = json.Marshal(afterNative.Blocks[0].Content)
	if afterNative.Revision.Version != 4 || !bytes.Equal(got, want) {
		t.Fatal("semantic CRDT comparison changed a native caller's explicit run representation")
	}
}
func generatedUpdate(t *testing.T, engine *crdtengine.Client, state document.CollaborationState, blocks []document.Block) document.CollaborationUpdate {
	t.Helper()
	canonical, err := document.Normalize(blocks)
	if err != nil {
		t.Fatal(err)
	}
	result, err := engine.Transform(t.Context(), document.CollaborationTransform{State: state.State, Blocks: &canonical})
	if err != nil {
		t.Fatal(err)
	}
	return document.CollaborationUpdate{OperationID: uuid.NewString(), Epoch: state.Epoch, Update: result.Update}
}
func copyBlocks(t *testing.T, blocks []document.Block) []document.Block {
	t.Helper()
	raw, err := json.Marshal(blocks)
	if err != nil {
		t.Fatal(err)
	}
	var result []document.Block
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result
}
func readCollaboration(t *testing.T, f fixture) document.CollaborationState {
	t.Helper()
	return testenv.Decode[document.CollaborationState](t, f.env.Call(t, "GET", f.path+"/collaboration", f.session.AccessToken, nil, 200))
}
func TestCollaborationConcurrentRichTextAndNativeCommandUseOneAuthority(t *testing.T) {
	f, engine, blocks, baseline := collaborationFixture(t)
	if baseline.ContentVersion != 2 || baseline.ProtocolVersion != 1 {
		t.Fatal("seeding changed the native revision")
	}
	seedAgain := testenv.Decode[document.CollaborationState](t, f.env.Call(t, "POST", f.path+"/collaboration", f.session.AccessToken, nil, 200))
	if !bytes.Equal(seedAgain.State, baseline.State) || seedAgain.Epoch != baseline.Epoch {
		t.Fatal("reopening reseeded binary identity")
	}
	a, b := copyBlocks(t, blocks), copyBlocks(t, blocks)
	a[0].Content[0].Text = "Base A"
	b[0].Content[0].Text = "Base B"
	b[0].Content[0].Marks = []string{"bold"}
	ua, ub := generatedUpdate(t, engine, baseline, a), generatedUpdate(t, engine, baseline, b)
	first := testenv.Decode[document.CollaborationResult](t, f.env.Call(t, "POST", f.path+"/collaboration/updates", f.session.AccessToken, ua, 200))
	second := testenv.Decode[document.CollaborationResult](t, f.env.Call(t, "POST", f.path+"/collaboration/updates", f.session.AccessToken, ub, 200))
	if first.ContentVersion != 3 || second.ContentVersion != 4 {
		t.Fatal("concurrent updates did not both commit")
	}
	replayed := testenv.Decode[document.CollaborationResult](t, f.env.Call(t, "POST", f.path+"/collaboration/updates", f.session.AccessToken, ua, 200))
	if replayed.OperationID != first.OperationID || replayed.ContentVersion != first.ContentVersion || replayed.Epoch != first.Epoch || replayed.Changed != first.Changed {
		t.Fatal("lost-response retry did not retain the original receipt")
	}
	changed := document.Payload{Type: "paragraph", Content: []document.TextRun{{Text: "CLI edit to another block"}}}
	f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 4, Operations: []document.Operation{{Type: "update_block", BlockID: blocks[1].ID, Block: &changed}}}, 200)
	c := copyBlocks(t, blocks)
	c[0].Content[0].Text = "Base C"
	uc := generatedUpdate(t, engine, baseline, c)
	f.env.Call(t, "POST", f.path+"/collaboration/updates", f.session.AccessToken, uc, 200)
	content := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200))
	var text strings.Builder
	for _, run := range content.Blocks[0].Content {
		text.WriteString(run.Text)
	}
	for _, part := range []string{"Base", "A", "B", "C"} {
		if !strings.Contains(text.String(), part) {
			t.Fatalf("concurrent text was lost: %q", text.String())
		}
	}
	if content.Blocks[1].Content[0].Text != "CLI edit to another block" {
		t.Fatal("binary merge overwrote the native API write")
	}
	state := readCollaboration(t, f)
	if state.ContentVersion != content.Revision.Version {
		t.Fatal("binary state and block projection did not commit together")
	}
	f.env.RestartApplication(t)
	after := readCollaboration(t, f)
	if !bytes.Equal(after.State, state.State) || after.Epoch != state.Epoch {
		t.Fatal("restart lost binary identity")
	}
}

func TestCollaborationReceiptFailureRollsBackBinaryAndNativeState(t *testing.T) {
	f, engine, blocks, baseline := collaborationFixture(t)
	blocks[0].Content[0].Text = "Must remain local until commit"
	update := generatedUpdate(t, engine, baseline, blocks)
	if err := f.env.DB.Exec("ALTER TABLE document_operations ADD CONSTRAINT reject_crdt_receipt CHECK(FALSE) NOT VALID").Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "POST", f.path+"/collaboration/updates", f.session.AccessToken, update, 500)
	unchanged := readCollaboration(t, f)
	if unchanged.ContentVersion != baseline.ContentVersion || !bytes.Equal(unchanged.State, baseline.State) {
		t.Fatal("failed receipt committed CRDT state")
	}
	var count int64
	if err := f.env.DB.Table("document_collaboration_updates").Where("document_id=?", f.documentID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("failed receipt left an update in the durable log")
	}
	if err := f.env.DB.Exec("ALTER TABLE document_operations DROP CONSTRAINT reject_crdt_receipt").Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "POST", f.path+"/collaboration/updates", f.session.AccessToken, update, 200)
}

func TestCollaborationAgentAndTableWritesReconcileBeforeOfflineTextMerge(t *testing.T) {
	f, engine, blocks, baseline := collaborationFixture(t)
	offline := copyBlocks(t, blocks)
	offline[0].Content[0].Text = "Base offline"
	update := generatedUpdate(t, engine, baseline, offline)
	tableBlock := document.Block{ID: uuid.NewString(), Type: "data_table"}
	position := 2
	f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 2, Operations: []document.Operation{{Type: "insert_blocks", Position: &position, Blocks: []document.Block{tableBlock}}}}, 200)
	created := testenv.Decode[table.Result](t, f.env.Call(t, "POST", f.path+"/tables", f.session.AccessToken, table.CreateInput{OperationID: uuid.NewString(), ExpectedDocumentVersion: 3, BlockID: tableBlock.ID}, 201))
	meta := testenv.Decode[struct {
		Definition table.Definition `json:"definition"`
	}](t, f.env.Call(t, "GET", f.path+"/tables/"+created.TableID, f.session.AccessToken, nil, 200))
	f.env.Call(t, "POST", f.path+"/tables/"+created.TableID+"/changes", f.session.AccessToken, table.MutationInput{OperationID: uuid.NewString(), ExpectedDocumentVersion: 4, ExpectedTableVersion: 1, Changes: table.Changes{Upserts: []table.Upsert{{ID: uuid.NewString(), Values: map[string]any{meta.Definition.Fields[0].ID: "Table record"}}}}}, 200)
	credential := testenv.Decode[struct {
		Token string `json:"token"`
	}](t, f.env.Call(t, "POST", "/api/v1/workspaces/"+f.workspaceID+"/integration-tokens", f.session.AccessToken, integration.TokenInput{Name: "CRDT integration writer", DocumentID: &f.documentID, Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}}, 201))
	updated := document.Payload{Type: "paragraph", Content: []document.TextRun{{Text: "Agent change"}}}
	command := document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 5, Operations: []document.Operation{{Type: "update_block", BlockID: blocks[1].ID, Block: &updated}}}
	path := "/api/v1/agent/workspaces/" + f.workspaceID + "/documents/" + f.documentID + "/operations"
	f.env.Call(t, "POST", path, credential.Token, command, 200)
	f.env.Call(t, "POST", f.path+"/collaboration/updates", f.session.AccessToken, update, 200)
	f.env.Call(t, "POST", path, credential.Token, command, 200)
	current := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200))
	if current.Revision.Version != 7 || current.Blocks[0].Content[0].Text != "Base offline" || current.Blocks[1].Content[0].Text != "Agent change" {
		t.Fatalf("cross-surface edit was lost: %+v", current)
	}
	if current.Blocks[2].Props["table_id"] != created.TableID || current.Blocks[2].Props["table_version"] != float64(2) {
		t.Fatal("binary merge rolled back embedded table reference")
	}
	state := readCollaboration(t, f)
	projected, err := engine.Transform(t.Context(), document.CollaborationTransform{State: state.State})
	if err != nil {
		t.Fatal(err)
	}
	left, _ := json.Marshal(current.Blocks)
	right, _ := json.Marshal(projected.Blocks)
	if !bytes.Equal(left, right) {
		t.Fatal("Agent/table/native projection diverged from binary authority")
	}
	// An external clipboard intent materializes an independent table in the same CRDT transaction.
	copied := copyBlocks(t, current.Blocks)
	copiedBlock := document.Block{ID: uuid.NewString(), Type: "data_table", Props: map[string]any{"table_id": created.TableID, "table_version": float64(2)}}
	copied = append(copied, copiedBlock)
	copyUpdate := generatedUpdate(t, engine, state, copied)
	copyUpdate.TableCopies = []document.TableCopy{{BlockID: copiedBlock.ID, Source: document.TableCopySource{WorkspaceID: f.workspaceID, DocumentID: f.documentID, TableID: created.TableID, DocumentVersion: 7}}}
	copyResult := testenv.Decode[document.CollaborationResult](t, f.env.Call(t, "POST", f.path+"/collaboration/updates", f.session.AccessToken, copyUpdate, 200))
	if copyResult.ContentVersion != 8 || len(copyResult.ResolvedBlocks) != 1 || copyResult.ResolvedBlocks[0].Payload.Props["table_id"] == created.TableID {
		t.Fatal("CRDT table copy did not materialize an independent reference")
	}
	replayCopy := testenv.Decode[document.CollaborationResult](t, f.env.Call(t, "POST", f.path+"/collaboration/updates", f.session.AccessToken, copyUpdate, 200))
	if replayCopy.ResolvedBlocks[0].Payload.Props["table_id"] != copyResult.ResolvedBlocks[0].Payload.Props["table_id"] {
		t.Fatal("lost copy acknowledgment created another table")
	}
}

func TestCollaborationRestoreFencesOfflineEpochAndPreservesHistory(t *testing.T) {
	f, engine, blocks, baseline := collaborationFixture(t)
	blocks[0].Content[0].Text = "Offline branch"
	update := generatedUpdate(t, engine, baseline, blocks)
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(2, uuid.NewString(), "Newer", []document.Block{block("Newer")}), 200)
	f.env.Call(t, "POST", f.path+"/restore", f.session.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 3, "source_version": 2}, 200)
	state := readCollaboration(t, f)
	if state.Epoch == baseline.Epoch {
		t.Fatal("history restore did not fence stale offline updates")
	}
	rejected := f.env.Call(t, "POST", f.path+"/collaboration/updates", f.session.AccessToken, update, 409)
	if rejected.Code != "COLLABORATION_EPOCH_CHANGED" {
		t.Fatal("stale offline branch was not explicitly recoverable")
	}
	old := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content?version=2", f.session.AccessToken, nil, 200))
	if old.Blocks[0].Content[0].Text != "Base" {
		t.Fatal("migration or restore rewrote old content")
	}
}

func TestCollaborationTransportTailBudgetAndCompaction(t *testing.T) {
	f, engine, blocks, baseline := collaborationFixture(t)
	scope := document.DirectoryScope{ActorID: f.session.User.ID, WorkspaceID: f.workspaceID, DocumentID: f.documentID}
	repository := docstore.NewWithCollaboration(f.env.DB, engine)
	setVersion := func(version int64) {
		t.Helper()
		if err := f.env.DB.Exec("UPDATE documents SET content_version=? WHERE id=?", version, f.documentID).Error; err != nil {
			t.Fatal(err)
		}
		if err := f.env.DB.Exec("UPDATE document_collaboration_states SET content_version=? WHERE document_id=?", version, f.documentID).Error; err != nil {
			t.Fatal(err)
		}
	}
	setVersion(5)
	for version := int64(3); version <= 5; version++ {
		if err := f.env.DB.Exec("INSERT INTO document_collaboration_updates(document_id,operation_id,content_version,epoch,update_data,created_at_ms) VALUES (?,?,?,?,decode(repeat('00',?), 'hex'),?)", f.documentID, uuid.NewString(), version, baseline.Epoch, 12<<20, time.Now().UnixMilli()).Error; err != nil {
			t.Fatal(err)
		}
	}
	large, changed, err := repository.ReadCollaboration(t.Context(), scope, 2)
	if err != nil || !changed || len(large.Updates) != 0 || !bytes.Equal(large.State, baseline.State) {
		t.Fatalf("oversized incremental tail was not replaced by bounded snapshot: %v", err)
	}
	if err := f.env.DB.Exec("DELETE FROM document_collaboration_updates WHERE document_id=?", f.documentID).Error; err != nil {
		t.Fatal(err)
	}
	setVersion(258)
	for version := int64(3); version <= 258; version++ {
		if err := f.env.DB.Exec("INSERT INTO document_collaboration_updates(document_id,operation_id,content_version,epoch,update_data,created_at_ms) VALUES (?,?,?,?,?,?)", f.documentID, uuid.NewString(), version, baseline.Epoch, []byte{0, 0}, time.Now().UnixMilli()).Error; err != nil {
			t.Fatal(err)
		}
	}
	updated := document.Payload{Type: "paragraph", Content: []document.TextRun{{Text: "After tail compaction"}}}
	f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 258, Operations: []document.Operation{{Type: "update_block", BlockID: blocks[0].ID, Block: &updated}}}, 200)
	var count int64
	if err := f.env.DB.Table("document_collaboration_updates").Where("document_id=?", f.documentID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count > 256 {
		t.Fatalf("transport tail grew past its retained version budget: %d", count)
	}
	compacted, changed, err := repository.ReadCollaboration(t.Context(), scope, 2)
	if err != nil || !changed || len(compacted.State) == 0 || len(compacted.Updates) != 0 {
		t.Fatalf("compacted range did not resynchronize a complete binary snapshot: %v", err)
	}
	latest, changed, err := repository.ReadCollaboration(t.Context(), scope, 258)
	if err != nil || !changed || len(latest.State) != 0 || len(latest.Updates) != 1 {
		t.Fatalf("current reader did not receive a bounded increment: %v", err)
	}
	var old struct{ OperationID string }
	if err := f.env.DB.Table("document_operations").Select("operation_id").Where("document_id=? AND result_version=2", f.documentID).Take(&old).Error; err != nil {
		t.Fatal(err)
	}
	replayed := testenv.Decode[content](t, f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, old.OperationID, "Initial", blocks), 200))
	if replayed.Revision.Version != 2 || replayed.Blocks[0].Content[0].Text != "Base" {
		t.Fatal("transport compaction changed native history or original operation receipt")
	}
}

func TestCollaborationSocketCommitsThenAcknowledgesAndRevokesAccess(t *testing.T) {
	f, engine, blocks, baseline := collaborationFixture(t)
	server := httptest.NewServer(f.env.Handler)
	t.Cleanup(server.Close)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+f.path+"/collaboration/socket", &websocket.DialOptions{Subprotocols: []string{"orbis.crdt.v1"}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	if err := wsjson.Write(ctx, conn, map[string]any{"type": "authenticate", "protocol_version": 1, "token": f.session.AccessToken, "after_version": 0}); err != nil {
		t.Fatal(err)
	}
	for {
		var frame struct {
			Type string `json:"type"`
		}
		if err := wsjson.Read(ctx, conn, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Type == "ready" {
			break
		}
	}
	blocks[0].Content[0].Text = "WebSocket durable edit"
	update := generatedUpdate(t, engine, baseline, blocks)
	if err := wsjson.Write(ctx, conn, map[string]any{"type": "update", "operation_id": update.OperationID, "epoch": update.Epoch, "update": update.Update}); err != nil {
		t.Fatal(err)
	}
	for {
		var frame struct {
			Type           string `json:"type"`
			OperationID    string `json:"operation_id"`
			ContentVersion int64  `json:"content_version"`
		}
		if err := wsjson.Read(ctx, conn, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Type == "ack" {
			if frame.OperationID != update.OperationID || frame.ContentVersion != 3 {
				t.Fatal("wrong acknowledgment")
			}
			break
		}
	}
	var receipts int64
	if err := f.env.DB.Table("document_operations").Where("document_id=? AND operation_id=?", f.documentID, update.OperationID).Count(&receipts).Error; err != nil {
		t.Fatal(err)
	}
	if receipts != 1 || readCollaboration(t, f).ContentVersion != 3 {
		t.Fatal("socket acknowledged an uncommitted write")
	}
	if err := f.env.DB.Exec("UPDATE workspace_members SET role='viewer' WHERE workspace_id=? AND user_id=?", f.workspaceID, f.session.User.ID).Error; err != nil {
		t.Fatal(err)
	}
	update.OperationID = uuid.NewString()
	if err := wsjson.Write(ctx, conn, map[string]any{"type": "update", "operation_id": update.OperationID, "epoch": update.Epoch, "update": update.Update}); err != nil {
		t.Fatal(err)
	}
	for {
		var frame struct {
			Type   string `json:"type"`
			Status int    `json:"status"`
		}
		if err := wsjson.Read(ctx, conn, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Type == "error" {
			if frame.Status != 403 {
				t.Fatalf("revoked editor got status %d", frame.Status)
			}
			break
		}
	}
}
