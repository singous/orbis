package publicview

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
)

func TestPublicURLBoundaries(t *testing.T) {
	id := uuid.NewString()
	policy := URLPolicy{InternalHosts: []string{"app.example.test"}, DocumentLinks: map[string]string{id: "/s/site/guide"}, PublicPrefixes: []string{"/s/site/"}}
	for _, value := range []string{
		"http://localhost/x", "http://LOCALHOST。/x", "http://127.0.0.1/x", "http://127。0。0。1/x", "http://2130706433/x", "http://0x7f.1/x", "http://[::ffff:127.0.0.1]/x", "http://10.0.0.1/x", "http://100.64.1.1/x", "http://intranet.local/x", "//evil.example/x", "file:///tmp/file", "https://a:b@example.test/x", "https://example.test/x?access_token=secret", "https://example.test/x#token=secret", "https://example.test/x?to%256ben=secret", "https://app.example.test/api/v1/me", "https://app。example。test/api/v1/me", "/api/v1/workspaces/private", "/s/site/../../api/v1/me", "/%25252e%25252e/api/me",
	} {
		if _, err := policy.Link(value); err == nil {
			t.Errorf("accepted private or sensitive URL %s", value)
		}
	}
	for _, value := range []string{"https://example.test/image.png?width=300", "https://[2606:4700:4700::1111]/image.png", "/s/site/guide#heading", "#heading"} {
		if _, err := policy.Link(value); err != nil {
			t.Errorf("rejected public URL %s: %v", value, err)
		}
	}
	rewritten, err := policy.Link("https://app.example.test/documents/" + id + "#heading")
	if err != nil || rewritten != "/s/site/guide#heading" {
		t.Fatalf("document link rewrite failed: %s %v", rewritten, err)
	}
}
func TestProjectionOmitsRetiredDrawingsAndTheirAssets(t *testing.T) {
	assetID := uuid.NewString()
	blocks, err := document.Normalize([]document.Block{{ID: uuid.NewString(), Type: "drawing", Props: map[string]any{"scene": "", "source": map[string]any{"type": "asset", "asset_id": assetID}, "caption": "Preview"}}})
	if err != nil {
		t.Fatal(err)
	}
	original, _ := json.Marshal(blocks)
	projected, err := Project(blocks, Options{Asset: func(id string) (string, error) {
		t.Fatal("retired drawing assets must not be delivered")
		return "", nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(projected) != 0 {
		t.Fatal("retired drawings must be omitted")
	}
	encoded, _ := json.Marshal(projected)
	for _, private := range []string{"scene", "asset_id", assetID} {
		if strings.Contains(string(encoded), private) {
			t.Fatalf("private metadata leaked: %s", encoded)
		}
	}
	after, _ := json.Marshal(blocks)
	if string(original) != string(after) {
		t.Fatal("public projection mutated draft")
	}
}

func TestLiveProjectionKeepsTextWhenLinkIsOutsideGrant(t *testing.T) {
	href := "/documents/" + uuid.NewString()
	blocks, err := document.Normalize([]document.Block{{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "Readable label", Href: &href}}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Project(blocks, Options{}); err == nil {
		t.Fatal("publication silently accepted a private link")
	}
	projected, err := Project(blocks, Options{RedactUnsafeLinks: true})
	if err != nil {
		t.Fatal(err)
	}
	if projected[0].Content[0].Text != "Readable label" || projected[0].Content[0].Href != nil {
		t.Fatal("live read lost text or disclosed private navigation")
	}
	if _, err := Project(blocks, Options{RedactUnsafeLinks: true, MaxBytes: 20}); err == nil {
		t.Fatal("public projection ignored aggregate response budget")
	}
}

func TestProjectionRequiresExplicitRendererProperties(t *testing.T) {
	input := []document.Block{{ID: uuid.NewString(), Type: "paragraph", Props: map[string]any{"editor_cache": map[string]any{"private": "secret"}}, Content: []document.TextRun{}, Children: []document.Block{}}}
	result, err := Project(input, Options{})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "editor_cache") || strings.Contains(string(encoded), "secret") {
		t.Fatal("new private metadata became public implicitly")
	}
}
