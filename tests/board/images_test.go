//go:build integration

package board_test

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/internal/sharing"
	"orbis.local/orbis/tests/testenv"
)

func TestBoardImagesFollowOwnerAndPublishedScope(t *testing.T) {
	f := setup(t)
	base := "/api/v1/workspaces/" + f.board.WorkspaceID
	pixels := image.NewNRGBA(image.Rect(0, 0, 16, 12))
	pixels.Set(0, 0, color.NRGBA{R: 80, G: 100, B: 200, A: 255})
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, pixels); err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "diagram.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(pngData.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", base+"/assets", &body)
	request.Header.Set("Authorization", "Bearer "+f.token)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := f.env.DoRequest(request)
	if err != nil || response.Status != 201 {
		t.Fatalf("upload: status %d, error %v", response.Status, err)
	}
	asset := testenv.Decode[struct{ ID string }](t, response)
	e := node(f.board.Pages[0].ID)
	e.ShapeType = "basic.image"
	e.Structure.AssetID = &asset.ID
	e.Text = ""
	f.change(t, board.Command{Type: "elements.create", Elements: []board.Element{e}})
	preview := f.env.Call(t, "GET", f.path+"/preview", f.token, nil, 200)
	if !strings.Contains(string(preview.Body), "data:image/png;base64,") {
		t.Fatal("private SVG lost image")
	}
	token := testenv.Decode[struct{ Token string }](t, f.env.Call(t, "POST", base+"/integration-tokens", f.token, integration.TokenInput{Name: "Image export", DocumentID: &f.board.DocumentID, Permissions: []integration.Permission{integration.DocumentsRead, integration.AssetsRead}}, 201))
	agent := "/api/v1/agent/workspaces/" + f.board.WorkspaceID
	file := f.env.Call(t, "GET", agent+"/documents/"+f.board.DocumentID+"/assets/"+asset.ID+"/content", token.Token, nil, 200)
	if !bytes.Equal(file.Body, pngData.Bytes()) {
		t.Fatal("agent file differs")
	}
	share := testenv.Decode[struct{ Token string }](t, f.env.Call(t, "POST", base+"/shares", f.token, sharing.CreateInput{CollectionID: f.board.CollectionID, RootDocumentID: &f.board.DocumentID, AcknowledgePublicScope: true}, 201))
	publicPath := "/api/v1/public/shares/" + share.Token + "/documents/" + f.board.DocumentID
	f.env.Call(t, "GET", publicPath+"/assets/"+asset.ID, "", nil, 200)
	f.env.Call(t, "GET", publicPath+"/assets/"+uuid.NewString(), "", nil, 404)
	site := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", base+"/sites", f.token, publishing.Config{Name: "Image site", Slug: "board-images", Navigation: []publishing.Navigation{{DocumentID: f.board.DocumentID, Slug: "images", Title: "Images"}}}, 201))
	sitePath := base + "/sites/" + site.ID
	before := testenv.Decode[publishing.Preview](t, f.env.Call(t, "GET", sitePath+"/preview", f.token, nil, 200))
	f.env.Call(t, "POST", sitePath+"/publish", f.token, publishing.PublishInput{OperationID: uuid.NewString(), ExpectedVersion: 1, ExpectedSourceFingerprint: before.SourceFingerprint}, 201)
	published := f.env.Call(t, "GET", "/api/v1/public/sites/board-images/pages/images", "", nil, 200)
	page := testenv.Decode[publishing.Page](t, published)
	if len(page.Blocks) != 1 || page.Blocks[0].Board == nil {
		t.Fatal("public board missing")
	}
	raw := page.Blocks[0].Board.SVG
	if strings.Contains(raw, "orbis-asset:") || strings.Contains(raw, "/workspaces/") {
		t.Fatal("published SVG contains a private asset path")
	}
	matches := regexp.MustCompile("/api/v1/public/sites/board-images/assets/[0-9a-f-]+[^\\\"< ]*").FindString(raw)
	if matches == "" {
		t.Fatal("published image URL missing")
	}
	f.env.Call(t, "GET", matches, "", nil, 200)
}
