//go:build integration

package sharing_test

import (
	"bytes"
	"image"
	"image/png"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	appstore "orbis.local/orbis/internal/app/postgres"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/publicview"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/sharing"
	sharestore "orbis.local/orbis/internal/sharing/postgres"
	"orbis.local/orbis/internal/table"
	"orbis.local/orbis/internal/workspace"
	"orbis.local/orbis/tests/testenv"
)

func upload(t *testing.T, f fixture) string {
	t.Helper()
	var buffer bytes.Buffer
	form := multipart.NewWriter(&buffer)
	part, err := form.CreateFormFile("file", "share-image.png")
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(part, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", f.base+"/assets", &buffer)
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+f.session.AccessToken)
	result, err := f.env.DoRequest(req)
	if err != nil || result.Status != 201 {
		t.Fatalf("upload: %+v %v", result, err)
	}
	return testenv.Decode[struct{ ID string }](t, result).ID
}
func TestLiveShareAssetsRequireActualCurrentMediaReference(t *testing.T) {
	f := newShare(t)
	file, unrelated := upload(t, f), upload(t, f)
	f.write(t, 1, []document.Block{{ID: uuid.NewString(), Type: "image", Props: map[string]any{"source": map[string]any{"type": "asset", "asset_id": file}, "alt": "Shared image"}}, paragraph("Text mentioning " + unrelated)})
	content := testenv.Decode[struct{ Blocks []publicview.Block }](t, f.env.Call(t, "GET", f.public()+"/documents/"+f.child+"/content", "", nil, 200))
	address := content.Blocks[0].Props["source"].(map[string]any)["url"].(string)
	response := f.env.Call(t, "GET", address, "", nil, 200)
	f.env.Call(t, "HEAD", address, "", nil, 200)
	if len(response.Body) == 0 || response.Header.Get("Content-Type") != "image/png" {
		t.Fatal("shared file was unavailable")
	}
	f.env.Call(t, "GET", f.public()+"/documents/"+f.child+"/assets/"+unrelated, "", nil, 404)
	f.env.Call(t, "GET", f.public()+"/documents/"+f.root+"/assets/"+file, "", nil, 404)
	f.write(t, 2, []document.Block{paragraph("Reference removed " + file)})
	f.env.Call(t, "GET", f.public()+"/documents/"+f.child+"/assets/"+file, "", nil, 404)
	f.env.Call(t, "GET", address, "", nil, 409)
}
func TestLiveShareTablePublicViewAndVersionPin(t *testing.T) {
	f := newShare(t)
	blockID := uuid.NewString()
	f.write(t, 1, []document.Block{{ID: blockID, Type: "data_table"}})
	visible, hidden, view := uuid.NewString(), uuid.NewString(), uuid.NewString()
	definition := table.Definition{Title: "Shared data", Fields: []table.Field{{ID: visible, Name: "Visible", Kind: "text"}, {ID: hidden, Name: "Hidden", Kind: "text"}}, Views: []table.View{{ID: view, Name: "Reader", Kind: "grid", Filters: []table.Filter{{FieldID: hidden, Operator: "eq", Value: "selector-secret"}}}}, PublicViewID: view, PublicFieldIDs: []string{visible}}
	created := testenv.Decode[table.Result](t, f.env.Call(t, "POST", f.docPath+"/tables", f.session.AccessToken, table.CreateInput{OperationID: uuid.NewString(), ExpectedDocumentVersion: 2, BlockID: blockID, Definition: &definition}, 201))
	rowID := uuid.NewString()
	changed := testenv.Decode[table.Result](t, f.env.Call(t, "POST", f.docPath+"/tables/"+created.TableID+"/changes", f.session.AccessToken, table.MutationInput{OperationID: uuid.NewString(), ExpectedDocumentVersion: created.ContentVersion, ExpectedTableVersion: created.TableVersion, Changes: table.Changes{Upserts: []table.Upsert{{ID: rowID, Values: map[string]any{visible: "public value", hidden: "selector-secret"}}}}}, 200))
	raw := f.env.Call(t, "GET", f.public()+"/documents/"+f.child+"/content", "", nil, 200)
	for _, value := range []string{hidden, "selector-secret", "filters", "Hidden", f.wid} {
		if strings.Contains(string(raw.Data), value) {
			t.Fatalf("share table leaked %s", value)
		}
	}
	content := testenv.Decode[struct{ Blocks []publicview.Block }](t, raw)
	ref := content.Blocks[0].DataTable
	if ref == nil || ref.Total != 1 || len(ref.Items) != 1 || ref.Items[0].Values[visible] != "public value" {
		t.Fatal("shared public view was not projected")
	}
	f.env.Call(t, "GET", ref.RecordsURL, "", nil, 200)
	f.env.Call(t, "POST", f.docPath+"/tables/"+created.TableID+"/changes", f.session.AccessToken, table.MutationInput{OperationID: uuid.NewString(), ExpectedDocumentVersion: changed.ContentVersion, ExpectedTableVersion: changed.TableVersion, Changes: table.Changes{Upserts: []table.Upsert{{ID: rowID, Values: map[string]any{visible: "live change"}}}}}, 200)
	f.env.Call(t, "GET", ref.RecordsURL, "", nil, 409)
	latest := f.env.Call(t, "GET", f.public()+"/documents/"+f.child+"/tables/"+created.TableID+"/records", "", nil, 200)
	if !strings.Contains(string(latest.Data), "live change") || strings.Contains(string(latest.Data), "selector-secret") {
		t.Fatal("live table did not use the current public projection")
	}
}
func TestLiveShareCreatorExitAndSigningKeyRotation(t *testing.T) {
	f := newShare(t)
	editor := f.env.AddUser(t, "editor@example.test")
	now := f.env.Clock.Now().UnixMilli()
	if err := f.env.DB.Exec("INSERT INTO workspace_members(workspace_id,user_id,role,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?)", f.wid, editor.User.ID, "editor", now, now).Error; err != nil {
		t.Fatal(err)
	}
	created := testenv.Decode[created](t, f.env.Call(t, "POST", f.base+"/shares", editor.AccessToken, sharing.CreateInput{CollectionID: f.cid, RootDocumentID: &f.root, AcknowledgePublicScope: true}, 201))
	f.env.Call(t, "DELETE", f.base+"/members/"+editor.User.ID, f.session.AccessToken, map[string]any{"expected_version": 1}, 200)
	f.env.Call(t, "GET", "/api/v1/public/shares/"+created.Token+"/directory", "", nil, 200)
	f.env.Call(t, "GET", f.base+"/shares", editor.AccessToken, nil, 404)
	access := workspace.New(appstore.NewWorkspaces(f.env.DB), f.env.Clock)
	rotated := sharing.New(sharestore.New(f.env.DB, f.env.Clock, "http://localhost:9202"), access, f.env.Clock, "a-different-32-byte-test-signing-key-2026", "")
	if _, err := rotated.Document(t.Context(), sharing.PublicQuery{Token: created.Token, DocumentID: f.child}); err != nil {
		t.Fatalf("key rotation revoked an existing bearer grant: %v", err)
	}
	page, _ := pagination.New(1, 100)
	records, _, err := rotated.List(t.Context(), sharing.ListQuery{Scope: sharing.Scope{ActorID: f.session.User.ID, WorkspaceID: f.wid}, Page: page})
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		if record.Share.ID == created.Share.ID && record.Path != nil {
			t.Fatal("rotated key returned a different invalid URL")
		}
	}
	f.env.Call(t, "POST", f.base+"/shares/"+created.Share.ID+"/revoke", f.session.AccessToken, map[string]any{"expected_version": 1}, 200)
	f.env.Call(t, "GET", "/api/v1/public/shares/"+created.Token+"/directory", "", nil, 404)
}

func TestLiveShareInlineCardAndGridAssetLinksAreExplicitReferences(t *testing.T) {
	f := newShare(t)
	file := upload(t, f)
	reference := document.AssetLink(file)
	f.write(t, 1, []document.Block{{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "Attachment", Href: &reference}}}, {ID: uuid.NewString(), Type: "card", Props: map[string]any{"title": "Card attachment", "href": reference}}, {ID: uuid.NewString(), Type: "table", Table: &document.Grid{Rows: [][]document.GridCell{{{Content: []document.TextRun{{Text: "Cell attachment", Href: &reference}}}}}}}})
	result := testenv.Decode[struct{ Blocks []publicview.Block }](t, f.env.Call(t, "GET", f.public()+"/documents/"+f.child+"/content", "", nil, 200))
	for _, address := range []string{*result.Blocks[0].Content[0].Href, result.Blocks[1].Props["href"].(string), *result.Blocks[2].Table.Rows[0][0].Content[0].Href} {
		if strings.HasPrefix(address, document.AssetLinkPrefix) {
			t.Fatal("asset identity was not rewritten to its capability-scoped delivery address")
		}
		f.env.Call(t, "GET", address, "", nil, 200)
	}
}
