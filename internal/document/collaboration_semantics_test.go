package document

import (
	"reflect"
	"testing"
)

func TestCollaborationRunRepresentationPreservesMeaningAndInput(t *testing.T) {
	href, color := "https://example.test/path", "#aabbcc"
	before := Payload{Type: "paragraph", Props: map[string]any{}, Content: []TextRun{{Text: "ab", Marks: []string{"italic", "bold"}, Href: &href, TextColor: &color}, {Text: "cd", Marks: []string{"bold", "italic"}, Href: &href, TextColor: &color}}}
	after := Payload{Type: "paragraph", Props: map[string]any{}, Content: []TextRun{{Text: "abcd", Marks: []string{"bold", "italic"}, Href: &href, TextColor: &color}}}
	if !EquivalentCollaborationPayload(before, after) {
		t.Fatal("lossless inline normalization was treated as data loss")
	}
	if !reflect.DeepEqual(before.Content[0].Marks, []string{"italic", "bold"}) || len(before.Content) != 2 {
		t.Fatal("comparison mutated the native source")
	}
	after.Content[0].Marks = []string{"bold"}
	if EquivalentCollaborationPayload(before, after) {
		t.Fatal("format loss was ignored")
	}
	after.Content[0].Marks = []string{"italic", "bold"}
	after.Content[0].Href = nil
	if EquivalentCollaborationPayload(before, after) {
		t.Fatal("link loss was ignored")
	}
	after.Content[0].Href = &href
	after.Content[0].Text = "abce"
	if EquivalentCollaborationPayload(before, after) {
		t.Fatal("changed text was ignored")
	}
	after.Content[0].Text = "abcd"
	after.Props["text_alignment"] = "center"
	if EquivalentCollaborationPayload(before, after) {
		t.Fatal("block properties were ignored")
	}
}

func TestCollaborationTreeAndTableIdentityRemainExact(t *testing.T) {
	cell := GridCell{RowSpan: 1, ColumnSpan: 1, Alignment: "left", Content: []TextRun{{Text: "a", Marks: []string{}}, {Text: "b", Marks: []string{}}}}
	left := []Block{{ID: "table", Type: "table", Props: map[string]any{}, Table: &Grid{Rows: [][]GridCell{{cell}}, ColumnWidths: []*int{nil}}, Children: []Block{}}}
	right := []Block{{ID: "table", Type: "table", Props: map[string]any{}, Table: &Grid{Rows: [][]GridCell{{{RowSpan: 1, ColumnSpan: 1, Alignment: "left", Content: []TextRun{{Text: "ab", Marks: []string{}}}}}}, ColumnWidths: []*int{nil}}, Children: []Block{}}}
	if !EquivalentCollaborationBlocks(left, right) {
		t.Fatal("equivalent table text was rejected")
	}
	right[0].ID = "other"
	if EquivalentCollaborationBlocks(left, right) {
		t.Fatal("block identity change was ignored")
	}
	right[0].ID = "table"
	right[0].Table.Rows[0][0].ColumnSpan = 2
	if EquivalentCollaborationBlocks(left, right) {
		t.Fatal("table geometry change was ignored")
	}
}
