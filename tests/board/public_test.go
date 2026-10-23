//go:build integration

package board_test

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/internal/sharing"
	"orbis.local/orbis/tests/testenv"
)

func TestPublicBoardSnapshotAndPrivateReferenceBoundary(t *testing.T) {
	f := setup(t)
	base := "/api/v1/workspaces/" + f.board.WorkspaceID
	e := node(f.board.Pages[0].ID)
	e.Text = "Published architecture"
	accepted := f.change(t, board.Command{Type: "elements.create", Elements: []board.Element{e}}).Elements[0]
	share := testenv.Decode[struct{ Token string }](t, f.env.Call(t, "POST", base+"/shares", f.token, sharing.CreateInput{CollectionID: f.board.CollectionID, RootDocumentID: &f.board.DocumentID, AcknowledgePublicScope: true}, 201))
	shared := f.env.Call(t, "GET", "/api/v1/public/shares/"+share.Token+"/documents/"+f.board.DocumentID+"/content", "", nil, 200)
	if !strings.Contains(string(shared.Data), "Published architecture") || strings.Contains(string(shared.Data), `"versions"`) {
		t.Fatal("public board projection missing or contains private state")
	}
	site := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", base+"/sites", f.token, publishing.Config{Name: "Board site", Slug: "board-site", Navigation: []publishing.Navigation{{DocumentID: f.board.DocumentID, Slug: "architecture", Title: "Architecture"}}}, 201))
	path := base + "/sites/" + site.ID
	preview := testenv.Decode[publishing.Preview](t, f.env.Call(t, "GET", path+"/preview", f.token, nil, 200))
	f.env.Call(t, "POST", path+"/publish", f.token, publishing.PublishInput{OperationID: uuid.NewString(), ExpectedVersion: 1, ExpectedSourceFingerprint: preview.SourceFingerprint}, 201)
	changed := "Private draft"
	f.change(t, board.Command{Type: "elements.update", Patches: []board.Patch{{ID: e.ID, Expected: accepted.Versions, Text: &changed}}})
	published := f.env.Call(t, "GET", "/api/v1/public/sites/board-site/pages/architecture", "", nil, 200)
	if !strings.Contains(string(published.Data), "Published architecture") || strings.Contains(string(published.Data), "Private draft") {
		t.Fatal("draft changed published board")
	}
	after := testenv.Decode[publishing.Preview](t, f.env.Call(t, "GET", path+"/preview", f.token, nil, 200))
	if after.SourceFingerprint == preview.SourceFingerprint {
		t.Fatal("board edit missing from source fingerprint")
	}
	doc := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", base+"/collections/"+f.board.CollectionID+"/documents", f.token, map[string]any{"title": "Reference"}, 201))
	f.env.Call(t, "PUT", base+"/documents/"+doc.ID+"/content", f.token, map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "title": "Reference", "blocks": []document.Block{{ID: uuid.NewString(), Type: "board", Props: map[string]any{"board_id": f.board.ID, "page_id": f.board.Pages[0].ID, "mode": "live", "revision": nil, "frame_id": nil}}}}, 200)
	other := testenv.Decode[struct{ Token string }](t, f.env.Call(t, "POST", base+"/shares", f.token, sharing.CreateInput{CollectionID: f.board.CollectionID, RootDocumentID: &doc.ID, AcknowledgePublicScope: true}, 201))
	restricted := f.env.Call(t, "GET", "/api/v1/public/shares/"+other.Token+"/documents/"+doc.ID+"/content", "", nil, 200)
	if strings.Contains(string(restricted.Data), "Private draft") || !strings.Contains(string(restricted.Data), `"restricted":true`) {
		t.Fatal("cross-document reference granted public board access")
	}
}
