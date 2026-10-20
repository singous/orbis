//go:build integration

package integration_test

import (
	"github.com/google/uuid"
	"net/url"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/tests/testenv"
	"strings"
	"testing"
)

func TestAgentSearchScopesBodyAnchorsAndCurrentVisibility(t *testing.T) {
	exact := "exact"
	f := newAgent(t, integration.TokenInput{DocumentID: &exact})
	blocks := []document.Block{}
	for range 5 {
		blocks = append(blocks, document.Block{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "Literal_% target <script>plain</script> " + strings.Repeat("x", 400)}}})
	}
	f.env.Call(t, "PUT", f.base+"/documents/"+f.did+"/content", f.owner.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 2, "title": "Searchable", "blocks": blocks}, 200)
	f.env.Call(t, "PUT", f.base+"/documents/"+f.other+"/content", f.owner.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "title": "Hidden", "blocks": blocks}, 200)
	type hit struct {
		Document struct {
			ID      string
			Version int64 `json:"content_version"`
		}
		Anchors []integration.SearchAnchor
	}
	type page struct {
		Items      []hit
		Pagination struct{ Total int64 }
	}
	result := testenv.Decode[page](t, f.env.Call(t, "GET", f.agent+"/search?q="+url.QueryEscape("literal_%"), f.credential.Token, nil, 200))
	if result.Pagination.Total != 1 || len(result.Items) != 1 || result.Items[0].Document.ID != f.did || result.Items[0].Document.Version != 3 || len(result.Items[0].Anchors) != 3 {
		t.Fatalf("wrong scoped search: %+v", result)
	}
	for _, anchor := range result.Items[0].Anchors {
		if anchor.BlockRevision != 3 || len([]rune(anchor.Snippet)) > 240 || !strings.Contains(anchor.Snippet, "<script>plain</script>") {
			t.Fatal("anchor did not preserve bounded plain text")
		}
	}
	empty := testenv.Decode[page](t, f.env.Call(t, "GET", f.agent+"/search", f.credential.Token, nil, 200))
	if len(empty.Items) != 0 || empty.Pagination.Total != 0 {
		t.Fatal("empty search exposed directory")
	}
	f.env.Call(t, "PUT", f.base+"/documents/"+f.did+"/archive", f.owner.AccessToken, map[string]any{"archived": true, "expected_directory_version": 4}, 200)
	hidden := testenv.Decode[page](t, f.env.Call(t, "GET", f.agent+"/search?q=literal", f.credential.Token, nil, 200))
	if len(hidden.Items) != 0 {
		t.Fatal("archive remained searchable")
	}
}
