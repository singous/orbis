//go:build integration

package document_test

import (
	bytespkg "bytes"
	"image"
	"image/png"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/tests/testenv"
)

func TestCollectionIconPresetsNormalizedImagesAndPatchNull(t *testing.T) {
	env := testenv.New(t)
	session, wid := env.Owner(t)
	base := "/api/v1/workspaces/" + wid
	preset := document.CollectionIcon{Type: "preset", Name: "book", Color: "mint"}
	collection := testenv.Decode[struct {
		ID               string
		Icon             *document.CollectionIcon
		Version          int64 `json:"metadata_version"`
		DirectoryVersion int64 `json:"directory_version"`
	}](t, env.Call(t, "POST", base+"/collections", session.AccessToken, map[string]any{"title": "Icon collection", "icon": preset}, 201))
	if collection.Icon == nil || collection.Icon.Name != "book" {
		t.Fatal("preset icon not persisted")
	}
	var buffer bytespkg.Buffer
	form := multipart.NewWriter(&buffer)
	part, err := form.CreateFormFile("file", "source.png")
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(part, image.NewNRGBA(image.Rect(0, 0, 4, 2))); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", base+"/collection-icons", &buffer)
	request.Header.Set("Content-Type", form.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+session.AccessToken)
	result, err := env.DoRequest(request)
	if err != nil || result.Status != 201 {
		t.Fatalf("icon upload failed: %+v %v", result, err)
	}
	icon := testenv.Decode[struct {
		ID        string
		MediaType string `json:"media_type"`
	}](t, result)
	if icon.MediaType != "image/png" {
		t.Fatal("icon was not normalized")
	}
	bytes := env.Call(t, "GET", base+"/assets/"+icon.ID+"/content", session.AccessToken, nil, 200)
	config, err := png.DecodeConfig(bytespkg.NewReader(bytes.Body))
	if err != nil || config.Width != 256 || config.Height != 256 {
		t.Fatal("icon size was not normalized")
	}
	path := base + "/collections/" + collection.ID
	updated := testenv.Decode[struct {
		Icon             *document.CollectionIcon
		Version          int64 `json:"metadata_version"`
		DirectoryVersion int64 `json:"directory_version"`
	}](t, env.Call(t, "PATCH", path, session.AccessToken, map[string]any{"expected_version": 1, "icon": document.CollectionIcon{Type: "image", AssetID: icon.ID}}, 200))
	if updated.Icon == nil || updated.Icon.AssetID != icon.ID || updated.Version != 2 || updated.DirectoryVersion != collection.DirectoryVersion {
		t.Fatal("icon changed the wrong version or was not persisted")
	}
	unchanged := testenv.Decode[struct{ Icon *document.CollectionIcon }](t, env.Call(t, "PATCH", path, session.AccessToken, map[string]any{"expected_version": 2, "title": "Renamed"}, 200))
	if unchanged.Icon == nil || unchanged.Icon.AssetID != icon.ID {
		t.Fatal("omitted icon reset its value")
	}
	cleared := testenv.Decode[struct{ Icon *document.CollectionIcon }](t, env.Call(t, "PATCH", path, session.AccessToken, map[string]any{"expected_version": 3, "icon": nil}, 200))
	if cleared.Icon != nil {
		t.Fatal("null did not restore default icon")
	}
	env.Call(t, "POST", base+"/collections", session.AccessToken, map[string]any{"title": "Invalid", "icon": map[string]any{"type": "preset", "name": "unknown", "color": "mint"}}, 422)
}
