//go:build integration

package sheet_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/sharing"
	"orbis.local/orbis/internal/sheet"
	"orbis.local/orbis/tests/testenv"
)

func TestStandaloneTableUsesDocumentDirectoryLifecycle(t *testing.T) {
	f := setup(t)
	base := "/api/v1/workspaces/" + f.table.WorkspaceID
	docPath := base + "/documents/" + f.table.DocumentID
	doc := testenv.Decode[struct {
		ID      string
		SheetID string `json:"sheet_id"`
		Version int64  `json:"content_version"`
	}](t, f.env.Call(t, "GET", docPath, f.token, nil, 200))
	if doc.ID == "" || doc.SheetID != f.table.ID {
		t.Fatal("table did not create an ordinary document entry")
	}
	directory := f.env.Call(t, "GET", base+"/collections/"+f.table.CollectionID+"/documents", f.token, nil, 200)
	if !strings.Contains(string(directory.Data), doc.ID) {
		t.Fatal("table document missing from directory")
	}
	f.env.Call(t, "POST", docPath+"/operations", f.token, map[string]any{"operation_id": uuid.NewString(), "expected_version": doc.Version, "operations": []map[string]any{{"type": "update_metadata", "title": "Renamed in directory"}}}, 200)
	table := testenv.Decode[sheet.Sheet](t, f.env.Call(t, "GET", f.path, f.token, nil, 200))
	if table.Title != "Renamed in directory" {
		t.Fatal("table title did not follow document title")
	}
	f.env.Call(t, "PUT", f.path, f.token, sheet.Update{Version: table.Version, Title: "Renamed in table", Definition: table.Definition}, 200)
	metadata := f.env.Call(t, "GET", docPath, f.token, nil, 200)
	if !strings.Contains(string(metadata.Data), "Renamed in table") {
		t.Fatal("table rename did not update document metadata")
	}
	version := testenv.Decode[struct {
		Version int64 `json:"content_version"`
	}](t, metadata).Version
	f.change(t, sheet.Patch{ID: uuid.NewString(), Values: map[string]any{table.Definition.Fields[0].ID: "Inline edit"}})
	if testenv.Decode[struct {
		Version int64 `json:"content_version"`
	}](t, f.env.Call(t, "GET", docPath, f.token, nil, 200)).Version != version {
		t.Fatal("cell edit rewrote document body")
	}
	collection := testenv.Decode[struct {
		Version int64 `json:"directory_version"`
	}](t, f.env.Call(t, "GET", base+"/collections/"+table.CollectionID, f.token, nil, 200))
	f.env.Call(t, "PUT", docPath+"/archive", f.token, map[string]any{"archived": true, "expected_directory_version": collection.Version}, 200)
	f.env.Call(t, "GET", f.path, f.token, nil, 404)
	list := f.env.Call(t, "GET", base+"/sheets", f.token, nil, 200)
	if strings.Contains(string(list.Data), table.ID) {
		t.Fatal("archived document leaked through table directory")
	}
}

func TestEmbeddedCreationDoesNotCreateAnotherDocumentAndOwnShareProjectsRecords(t *testing.T) {
	f := setup(t)
	base := "/api/v1/workspaces/" + f.table.WorkspaceID
	doc := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", base+"/collections/"+f.table.CollectionID+"/documents", f.token, map[string]any{"title": "Host document"}, 201))
	in := sheet.Create{ID: uuid.NewString(), DocumentID: doc.ID, CollectionID: f.table.CollectionID, Title: "Embedded", Template: ""}
	embedded := testenv.Decode[sheet.Sheet](t, f.env.Call(t, "POST", base+"/sheets", f.token, in, 201))
	f.env.Call(t, "POST", base+"/sheets", f.token, in, 201)
	var count int64
	if err := f.env.DB.Table("documents").Where("collection_id=?", f.table.CollectionID).Count(&count).Error; err != nil || count != 2 {
		t.Fatal("embedded table or retry created an extra page")
	}
	if embedded.DocumentID != doc.ID {
		t.Fatal("embedded table has the wrong owner")
	}
	field := f.table.Definition.Fields[0].ID
	f.change(t, sheet.Patch{ID: uuid.NewString(), Values: map[string]any{field: "Owned public value"}})
	share := testenv.Decode[struct{ Token string }](t, f.env.Call(t, "POST", base+"/shares", f.token, sharing.CreateInput{CollectionID: f.table.CollectionID, RootDocumentID: &f.table.DocumentID, AcknowledgePublicScope: true}, 201))
	content := f.env.Call(t, "GET", "/api/v1/public/shares/"+share.Token+"/documents/"+f.table.DocumentID+"/content", "", nil, 200)
	if !strings.Contains(string(content.Data), "Owned public value") {
		t.Fatal("sharing the table document did not project its own records")
	}
}

func TestTableDocumentCreationRollsBackWithInvalidParent(t *testing.T) {
	f := setup(t)
	parent := uuid.NewString()
	id := uuid.NewString()
	f.env.Call(t, "POST", "/api/v1/workspaces/"+f.table.WorkspaceID+"/sheets", f.token, sheet.Create{ID: id, CollectionID: f.table.CollectionID, Title: "Invalid parent", ParentID: &parent}, 404)
	var count int64
	if err := f.env.DB.Table("sheets").Where("id=?", id).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("failed page creation left an orphan data table")
	}
	// Adding prose through the normal content API restores the mixed-document presentation.
	base := "/api/v1/workspaces/" + f.table.WorkspaceID + "/documents/" + f.table.DocumentID
	f.env.Call(t, "POST", base+"/operations", f.token, map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "operations": []map[string]any{{"type": "insert_blocks", "blocks": []map[string]any{{"id": uuid.NewString(), "type": "paragraph", "props": map[string]any{}, "content": []map[string]any{{"text": "Additional prose", "marks": []any{}, "href": nil}}, "children": []any{}}}}}}, 200)
	metadata := f.env.Call(t, "GET", base, f.token, nil, 200)
	var result map[string]any
	if err := json.Unmarshal(metadata.Data, &result); err != nil {
		t.Fatal(err)
	}
	if result["sheet_id"] != nil {
		t.Fatal("mixed document would hide prose behind a table-only page")
	}
}
