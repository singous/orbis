package document

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/platform/security"
)

func structure(t *testing.T, blocks []Block) []StructureNode {
	t.Helper()
	records, err := Flatten(blocks)
	if err != nil {
		t.Fatal(err)
	}
	result := []StructureNode{}
	for _, record := range records {
		var p Payload
		if err := json.Unmarshal(record.Payload, &p); err != nil {
			t.Fatal(err)
		}
		cells := 0
		if p.Table != nil {
			cells = len(p.Table.Rows) * len(p.Table.ColumnWidths)
		}
		result = append(result, StructureNode{ID: record.ID, ParentID: record.ParentID, Position: record.Position, Type: p.Type, Revision: 1, PayloadBytes: len(record.Payload), PayloadDigest: security.Digest(string(record.Payload)), GridCells: cells})
	}
	return result
}
func TestIncrementalSizeAccountingMatchesCanonicalTree(t *testing.T) {
	roots := []Block{{ID: uuid.NewString(), Type: "group", Children: []Block{{ID: uuid.NewString(), Type: "paragraph", Content: []TextRun{{Text: "中文 < & > \"", Marks: []string{"bold"}}}}, {ID: uuid.NewString(), Type: "quote", Children: []Block{{ID: uuid.NewString(), Type: "paragraph", Content: []TextRun{{Text: "nested"}}}}}}}, {ID: uuid.NewString(), Type: "table", Table: &Grid{Rows: [][]GridCell{{{Content: []TextRun{{Text: "cell"}}}}}}}}
	blocks, err := Normalize(roots)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(blocks)
	if err != nil {
		t.Fatal(err)
	}
	size, err := EncodedTreeBytes(structure(t, blocks))
	if err != nil || size != len(encoded) {
		t.Fatalf("cached size %d differs from actual %d: %v", size, len(encoded), err)
	}
}
func TestShallowUpdatePreservesUnloadedChildren(t *testing.T) {
	parent, child := uuid.NewString(), uuid.NewString()
	blocks, err := Normalize([]Block{{ID: parent, Type: "quote", Content: []TextRun{{Text: "before"}}, Children: []Block{{ID: child, Type: "paragraph", Content: []TextRun{{Text: "unloaded child"}}}}}})
	if err != nil {
		t.Fatal(err)
	}
	p := Payload{Type: "quote", Content: []TextRun{{Text: "after"}}}
	plan, err := PlanCommands(Document{ID: uuid.NewString(), Title: "Doc", ContentVersion: 1}, structure(t, blocks), []Operation{{Type: "update_block", BlockID: parent, Block: &p}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Upserts) != 1 || plan.Upserts[0].ID != parent || len(plan.DeletedIDs) != 0 {
		t.Fatal("shallow update rewrote or deleted an unloaded subtree")
	}
}
func TestCommandsRequireExplicitSubtreeDeletionAndUniqueText(t *testing.T) {
	parent, child := uuid.NewString(), uuid.NewString()
	blocks, err := Normalize([]Block{{ID: parent, Type: "group", Children: []Block{{ID: child, Type: "paragraph", Content: []TextRun{{Text: "ababa"}}}}}})
	if err != nil {
		t.Fatal(err)
	}
	metadata := structure(t, blocks)
	doc := Document{ID: uuid.NewString(), Title: "Doc", ContentVersion: 1}
	if _, err := PlanCommands(doc, metadata, []Operation{{Type: "delete_block", BlockID: parent}}, nil); err == nil {
		t.Fatal("container deletion lacked explicit subtree acknowledgement")
	}
	if _, err := PlanCommands(doc, metadata, []Operation{{Type: "move_block", BlockID: parent, ParentID: &child}}, nil); err == nil {
		t.Fatal("move created a cycle")
	}
	records, _ := Flatten(blocks)
	payloads := map[string]Payload{}
	for _, r := range records {
		var p Payload
		_ = json.Unmarshal(r.Payload, &p)
		payloads[r.ID] = p
	}
	if _, err := PlanCommands(doc, metadata, []Operation{{Type: "replace_text", BlockID: child, Match: "aba", Replacement: "x"}}, payloads); err == nil {
		t.Fatal("overlapping matches were accepted")
	}
}
