package document_test

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/document"
)

func paragraph(text string) document.Block {
	return document.Block{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: text}}}
}

func TestNormalizeDepthAndIdentity(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name      string
		depth     int
		wantError bool
	}{
		{name: "maximum depth", depth: document.MaxDepth},
		{name: "excess depth", depth: document.MaxDepth + 1, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			block := paragraph("leaf")
			for range test.depth - 1 {
				block = document.Block{ID: uuid.NewString(), Type: "group", Children: []document.Block{block}}
			}
			_, err := document.Normalize([]document.Block{block})
			if (err != nil) != test.wantError {
				t.Fatalf("Normalize error = %v", err)
			}
		})
	}
	t.Run("duplicate identity", func(t *testing.T) {
		block := paragraph("duplicate")
		if _, err := document.Normalize([]document.Block{block, block}); err == nil {
			t.Fatal("duplicate block ID accepted")
		}
	})
}

func TestFlattenRoundTrip(t *testing.T) {
	t.Parallel()
	input := []document.Block{
		{ID: uuid.NewString(), Type: "group", Children: []document.Block{paragraph("child")}},
		paragraph("root"),
	}
	normalized, err := document.Normalize(input)
	if err != nil {
		t.Fatal(err)
	}
	records, err := document.Flatten(normalized)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 3 {
		t.Fatalf("got %d records, want 3", len(records))
	}
	actual, err := document.Expand(records)
	if err != nil {
		t.Fatal(err)
	}
	wantJSON, err := json.Marshal(normalized)
	if err != nil {
		t.Fatal(err)
	}
	actualJSON, err := json.Marshal(actual)
	if err != nil {
		t.Fatal(err)
	}
	if string(wantJSON) != string(actualJSON) {
		t.Fatal("nested content changed during storage round trip")
	}
}

func TestSafeLink(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name, url string
		allowed   bool
	}{
		{name: "https", url: "https://example.test/docs", allowed: true},
		{name: "local path", url: "/s/manual/page", allowed: true},
		{name: "email", url: "mailto:help@example.test", allowed: true},
		{name: "email subject", url: "mailto:help@example.test?subject=Hello%20Orbis", allowed: true},
		{name: "empty email", url: "mailto:"},
		{name: "email without recipient", url: "mailto:?subject=Hello"},
		{name: "email authority", url: "mailto://example.test"},
		{name: "email absolute path", url: "mailto:/help@example.test"},
		{name: "email control character", url: "mailto:help@example.test\r\nBcc:other@example.test"},
		{name: "javascript", url: "javascript:alert(1)"},
		{name: "protocol relative", url: "//example.test"},
		{name: "credentials", url: "https://secret@example.test"},
		{name: "backslash", url: "/\\example.test"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := document.SafeLink(test.url); got != test.allowed {
				t.Fatalf("allowed = %v", got)
			}
		})
	}
}
