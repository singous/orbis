//go:build integration

package asset_test

import (
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/tests/testenv"
)

func TestMediaReferencesScopeHistoryAndIdempotency(t *testing.T) {
	env := testenv.New(t)
	owner, wid := env.Owner(t)
	base := "/api/v1/workspaces/" + wid
	root := base + "/assets"
	picture := putFile(
		t,
		env,
		root,
		owner.AccessToken,
		"photo.png",
		"image/png",
		imageBytes(t),
	)
	attachment := putFile(
		t,
		env,
		root,
		owner.AccessToken,
		"guide.txt",
		"text/plain",
		[]byte("guide"),
	)
	collection := testenv.Decode[struct{ ID string }](t, env.Call(
		t,
		"POST",
		base+"/collections",
		owner.AccessToken,
		map[string]any{"title": "Media"},
		201,
	))
	doc := testenv.Decode[struct{ ID string }](t, env.Call(
		t,
		"POST",
		base+"/collections/"+collection.ID+"/documents",
		owner.AccessToken,
		map[string]any{"title": "Media"},
		201,
	))
	path := base + "/documents/" + doc.ID
	block := func(kind string, source any) map[string]any {
		return map[string]any{"id": uuid.NewString(), "type": kind, "props": map[string]any{"source": source, "caption": "caption"}}
	}
	local := func(id string) map[string]any { return map[string]any{"type": "asset", "asset_id": id} }
	external := map[string]any{"type": "external", "url": "https://example.test/video.mp4"}
	blocks := []any{block("image", local(picture.ID)), block("file", local(attachment.ID)), block("video", external), block("audio", nil)}
	body := map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "title": "Media", "blocks": blocks}
	env.Call(
		t,
		"PUT",
		path+"/content",
		owner.AccessToken,
		body,
		200,
	)
	env.Call(
		t,
		"PUT",
		path+"/content",
		owner.AccessToken,
		body,
		200,
	)
	env.Call(
		t,
		"PUT",
		path+"/content",
		owner.AccessToken,
		map[string]any{"operation_id": uuid.NewString(), "expected_version": 2, "title": "Cleared", "blocks": []any{}},
		200,
	)
	restored := testenv.Decode[struct {
		Revision struct{ Version int64 }
		Blocks   []any
	}](t, env.Call(
		t,
		"POST",
		path+"/restore",
		owner.AccessToken,
		map[string]any{"operation_id": uuid.NewString(), "expected_version": 3, "source_version": 2},
		200,
	))
	if restored.Revision.Version != 4 || len(restored.Blocks) != 4 {
		t.Fatal("media blocks were not preserved across history restoration")
	}
	env.Call(
		t,
		"GET",
		path+"/blocks?version=2&page_size=2",
		owner.AccessToken,
		nil,
		200,
	)
	for _, test := range []struct {
		block  any
		status int
	}{
		{block("image", local(attachment.ID)), 422},
		{block("image", local(uuid.NewString())), 404},
		{block("image", map[string]any{"type": "external", "url": "file:///etc/passwd"}), 422},
		{block("image", map[string]any{"type": "external", "url": "https://user:secret@example.test/photo.png"}), 422},
		{block("image", map[string]any{"type": "asset", "asset_id": picture.ID, "url": "https://example.test/"}), 422},
	} {
		env.Call(
			t,
			"PUT",
			path+"/content",
			owner.AccessToken,
			map[string]any{"operation_id": uuid.NewString(), "expected_version": 4, "title": "Invalid", "blocks": []any{test.block}},
			test.status,
		)
	}
	other := testenv.Decode[struct{ ID string }](t, env.Call(
		t,
		"POST",
		"/api/v1/workspaces",
		owner.AccessToken,
		map[string]any{"name": "Other"},
		201,
	))
	foreign := putFile(
		t,
		env,
		"/api/v1/workspaces/"+other.ID+"/assets",
		owner.AccessToken,
		"foreign.png",
		"image/png",
		imageBytes(t),
	)
	invalid := env.Call(
		t,
		"PUT",
		path+"/content",
		owner.AccessToken,
		map[string]any{"operation_id": uuid.NewString(), "expected_version": 4, "title": "Foreign", "blocks": []any{block("image", local(foreign.ID))}},
		404,
	)
	if invalid.Code != "ASSET_REFERENCE_NOT_FOUND" {
		t.Fatal("foreign asset was not rejected at the reference boundary")
	}
	unchanged := testenv.Decode[struct {
		Revision struct{ Version int64 }
		Blocks   []any
	}](t, env.Call(
		t,
		"GET",
		path+"/content",
		owner.AccessToken,
		nil,
		200,
	))
	if unchanged.Revision.Version != 4 || len(unchanged.Blocks) != 4 {
		t.Fatal("invalid reference partially changed content")
	}
}
