package quicknote

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
)

func TestCaptureValidation(t *testing.T) {
	text := func(value string) document.Block {
		return document.Block{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: value}}}
	}
	cases := []struct {
		name   string
		blocks []document.Block
		valid  bool
	}{
		{"text", []document.Block{text("An idea")}, true},
		{"formatting only", []document.Block{text(" \n ")}, false},
		{"missing media", []document.Block{{ID: uuid.NewString(), Type: "image"}}, false},
		{"private attachment", []document.Block{{ID: uuid.NewString(), Type: "file", Props: map[string]any{"source": map[string]any{"type": "asset", "asset_id": uuid.NewString()}}}}, true},
		{"unsafe media", []document.Block{{ID: uuid.NewString(), Type: "image", Props: map[string]any{"source": map[string]any{"type": "external", "url": "javascript:alert(1)"}}}}, false},
		{"oversized capture", []document.Block{text(strings.Repeat("x", MaxContentBytes))}, false},
		{"unsupported embedded resource", []document.Block{{ID: uuid.NewString(), Type: "data_table", Props: map[string]any{"table_id": nil, "table_version": nil}}, text("A table")}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Normalize(tc.blocks)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
		})
	}
}
