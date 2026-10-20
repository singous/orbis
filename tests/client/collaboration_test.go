//go:build integration

package client_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/crdtengine"
	"orbis.local/orbis/tests/testenv"
)

func TestCLICollaborationWriteAndOfflineBrowserDeltaKeepOneDurableBody(t *testing.T) {
	c, env, lost, cid := cliFixtureWithEnvironment(t, false, testenv.NewWithCollaboration(t))
	created := c.run(0, "documents", "import", "--collection", cid, "--title", "Collaborative CLI document", "--operation-id", uuid.NewString(), "--file", c.file("initial.md", []byte("First paragraph\n\nSecond paragraph")))
	did := created["document_id"].(string)
	owner := env.Login(t, "owner@example.test")
	path := "/api/v1/workspaces/" + c.workspace + "/documents/" + did
	initial := testenv.Decode[struct{ Blocks []document.Block }](t, env.Call(t, "GET", path+"/content", owner.AccessToken, nil, 200))
	if len(initial.Blocks) != 2 {
		t.Fatal("CLI fixture did not import two paragraphs")
	}
	baseline := testenv.Decode[document.CollaborationState](t, env.Call(t, "POST", path+"/collaboration", owner.AccessToken, nil, 200))
	engine, err := crdtengine.New(os.Getenv("ORBIS_TEST_COLLABORATION_URL"), os.Getenv("ORBIS_TEST_COLLABORATION_KEY"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(engine.Close)
	initial.Blocks[0].Content[0].Text = "Offline browser paragraph"
	canonical, err := document.Normalize(initial.Blocks)
	if err != nil {
		t.Fatal(err)
	}
	offline, err := engine.Transform(t.Context(), document.CollaborationTransform{State: baseline.State, Blocks: &canonical})
	if err != nil {
		t.Fatal(err)
	}
	operation := uuid.NewString()
	body, err := json.Marshal(document.CommandsInput{OperationID: operation, ExpectedVersion: 1, Operations: []document.Operation{{Type: "replace_text", BlockID: initial.Blocks[1].ID, Match: "Second", Replacement: "CLI"}}})
	if err != nil {
		t.Fatal(err)
	}
	file := c.file("edit.json", body)
	lost.Store(true)
	result := c.run(0, "operations", "apply", "--document", did, "--file", file)
	if result["content_version"] != float64(2) {
		t.Fatal("CLI did not recover the original durable operation after response loss")
	}
	merged := testenv.Decode[document.CollaborationResult](t, env.Call(t, "POST", path+"/collaboration/updates", owner.AccessToken, document.CollaborationUpdate{OperationID: uuid.NewString(), Epoch: baseline.Epoch, Update: offline.Update}, 200))
	if merged.ContentVersion != 3 {
		t.Fatal("offline browser update did not commit after the CLI write")
	}
	state := testenv.Decode[document.CollaborationState](t, env.Call(t, "GET", path+"/collaboration", owner.AccessToken, nil, 200))
	projected, err := engine.Transform(t.Context(), document.CollaborationTransform{State: state.State})
	if err != nil || state.ContentVersion != 3 || len(projected.Blocks) != 2 || projected.Blocks[0].Content[0].Text != "Offline browser paragraph" || projected.Blocks[1].Content[0].Text != "CLI paragraph" {
		t.Fatalf("persistent binary lost a browser or CLI edit: %v", err)
	}
	if c.run(0, "operations", "apply", "--document", did, "--file", file)["content_version"] != float64(2) {
		t.Fatal("old CLI receipt changed after a later CRDT commit")
	}
	output := filepath.Join(c.directory, "merged.md")
	c.run(0, "documents", "export", did, "--version", "3", "--format", "markdown", "--out", output)
	exported, err := os.ReadFile(output)
	if err != nil || !bytes.Contains(exported, []byte("Offline browser paragraph")) || !bytes.Contains(exported, []byte("CLI paragraph")) {
		t.Fatal("CLI export did not read the merged durable native projection")
	}
}
