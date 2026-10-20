package document_test

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/document"
)

func TestRichComponentsAndGridRoundTrip(t *testing.T) {
	color := "#12ab89"
	width := 240
	href := "https://example.test/docs"
	input := []document.Block{
		{ID: uuid.NewString(), Type: "callout", Content: []document.TextRun{{Text: "Note", TextColor: &color}}},
		{
			ID:       uuid.NewString(),
			Type:     "card_group",
			Children: []document.Block{{ID: uuid.NewString(), Type: "card", Props: map[string]any{"href": href}, Children: []document.Block{paragraph("Body")}}},
		},
		{
			ID:       uuid.NewString(),
			Type:     "steps",
			Children: []document.Block{{ID: uuid.NewString(), Type: "step", Children: []document.Block{paragraph("Install")}}},
		},
		{ID: uuid.NewString(), Type: "tabs", Children: []document.Block{{ID: uuid.NewString(), Type: "tab", Children: []document.Block{paragraph("Linux")}}}},
		{
			ID:       uuid.NewString(),
			Type:     "code_group",
			Children: []document.Block{{ID: uuid.NewString(), Type: "code_block", Content: []document.TextRun{{Text: "go test ./..."}}}},
		},
		{ID: uuid.NewString(), Type: "table", Table: &document.Grid{HeaderRows: 1, ColumnWidths: []*int{nil, &width}, Rows: [][]document.GridCell{
			{{Content: []document.TextRun{{Text: "Name"}}}, {Content: []document.TextRun{{Text: "Value", Marks: []string{"bold"}}}}},
			{{Content: []document.TextRun{{Text: "Docs", Href: &href}}, Alignment: "center", BackgroundColor: &color}},
		}}},
	}
	before, _ := json.Marshal(input)
	normalized, err := document.Normalize(input)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(input)
	if string(before) != string(after) {
		t.Fatal("normalization mutated authored input")
	}
	if normalized[0].Props["tone"] != "info" || normalized[1].Props["columns"] != float64(2) {
		t.Fatal("component defaults were not supplied")
	}
	grid := normalized[5].Table
	if grid == nil || len(grid.Rows[1]) != 2 || grid.Rows[1][1].Content == nil || grid.Rows[1][1].Alignment != "left" {
		t.Fatal("partial table was not normalized to a rectangular grid")
	}
	records, err := document.Flatten(normalized)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := document.Expand(records)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored, normalized) {
		t.Fatal("rich content changed during temporal storage round trip")
	}
}
func TestEmailLinksPreserveTargetsAndRemainInvalidMedia(t *testing.T) {
	t.Parallel()
	href := "mailto:help@example.test?subject=Hello%20Orbis"
	input := []document.Block{
		{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "Contact", Href: &href, Marks: []string{"bold"}}}},
		{ID: uuid.NewString(), Type: "card", Props: map[string]any{"title": "Email", "href": href}},
		{ID: uuid.NewString(), Type: "table", Table: &document.Grid{Rows: [][]document.GridCell{{{Content: []document.TextRun{{Text: "Contact", Href: &href}}}}}}},
	}
	normalized, err := document.Normalize(input)
	if err != nil {
		t.Fatal(err)
	}
	records, err := document.Flatten(normalized)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := document.Expand(records)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored, normalized) || *restored[0].Content[0].Href != href || restored[1].Props["href"] != href || *restored[2].Table.Rows[0][0].Content[0].Href != href {
		t.Fatal("email targets changed during normalization or storage")
	}
	for _, kind := range []string{"image", "audio", "video", "file"} {
		block := document.Block{ID: uuid.NewString(), Type: kind, Props: map[string]any{"source": map[string]any{"type": "external", "url": href}}}
		if _, err := document.Normalize([]document.Block{block}); err == nil {
			t.Fatalf("email target accepted as %s media", kind)
		}
	}
}

func TestComponentValidationRejectsHiddenContentAndUnsafeStyles(t *testing.T) {
	invalidColor := "url(javascript:alert(1))"
	for _, block := range []document.Block{
		{Type: "card", Content: []document.TextRun{{Text: "hidden"}}},
		{Type: "tabs", Children: []document.Block{paragraph("outside tab")}},
		{Type: "card_group", Props: map[string]any{"columns": 4}},
		{Type: "callout", Props: map[string]any{"tone": "execute"}},
		{Type: "card", Props: map[string]any{"href": "javascript:alert(1)"}},
		{Type: "paragraph", Props: map[string]any{"text_alignment": "absolute"}},
		{Type: "paragraph", Content: []document.TextRun{{Text: "bad", TextColor: &invalidColor}}},
		{Type: "paragraph", Content: []document.TextRun{{Text: "a\x00b"}}},
		{Type: "paragraph", Table: &document.Grid{}},
		{Type: "table", Table: &document.Grid{HeaderRows: 1}},
		{Type: "table", Table: &document.Grid{Rows: make([][]document.GridCell, document.MaxGridRows+1)}},
		{Type: "data_table", Props: map[string]any{"table_id": uuid.NewString()}},
	} {
		block.ID = uuid.NewString()
		if _, err := document.Normalize([]document.Block{block}); err == nil {
			t.Fatalf("invalid %s block accepted", block.Type)
		}
	}
}
func TestDrawingSceneAndPreviewContract(t *testing.T) {
	sourceID := uuid.NewString()
	scene := `{"version":1,"elements":[{"id":"label","type":"text","x":0,"y":0,"width":100,"height":30,"text":"Continue editing","seed":42}],"appState":{"viewBackgroundColor":"#ffffff"}}`
	block := document.Block{
		ID:    uuid.NewString(),
		Type:  "drawing",
		Props: map[string]any{"scene": scene, "caption": "Diagram", "source": map[string]any{"type": "asset", "asset_id": sourceID}},
	}
	normalized, err := document.Normalize([]document.Block{block})
	if err != nil {
		t.Fatal(err)
	}
	if normalized[0].Props["scene"] != scene {
		t.Fatal("editable drawing data was changed")
	}
	references := document.MediaReferences(normalized)
	if len(references) != 1 || references[0].ID != sourceID || references[0].Kind != "image" {
		t.Fatal("drawing preview did not participate in image authorization")
	}
	empty, err := document.Normalize([]document.Block{{ID: uuid.NewString(), Type: "drawing"}})
	if err != nil || empty[0].Props["source"] != nil {
		t.Fatal("empty drawing placeholder failed")
	}
	for _, bad := range []string{
		"null",
		"[]",
		"invalid",
		strings.Repeat(" ", document.MaxDrawingBytes+1),
		strings.Replace(scene, `"version":1`, `"version":2`, 1),
		strings.Replace(scene, `"width":100`, `"width":-1`, 1),
		strings.Replace(scene, `"type":"text"`, `"type":"image"`, 1),
		strings.Replace(scene, `"x":0`, `"x":true`, 1),
		strings.Replace(scene, `"seed":42`, `"link":"https://example.test/"`, 1),
	} {
		block.Props["scene"] = bad
		if _, err := document.Normalize([]document.Block{block}); err == nil {
			t.Fatal("invalid drawing scene accepted")
		}
	}
	block.Props["scene"] = scene
	block.Props["source"] = nil
	if _, err := document.Normalize([]document.Block{block}); err == nil {
		t.Fatal("nonempty drawing without preview accepted")
	}
}

func TestGridPaddingUsesOneDocumentBudget(t *testing.T) {
	blocks := []document.Block{}
	for range document.MaxDocumentGridCells/document.MaxGridCells + 1 {
		blocks = append(blocks, document.Block{
			ID: uuid.NewString(), Type: "table",
			Table: &document.Grid{Rows: make([][]document.GridCell, 1000), ColumnWidths: make([]*int, 10)},
		})
	}
	if _, err := document.Normalize(blocks); err == nil {
		t.Fatal("sparse tables expanded past the document cell budget")
	}
}

func TestMergedGridCellsPreservePackedRowsAndRejectOverlap(t *testing.T) {
	input := document.Block{ID: uuid.NewString(), Type: "table", Table: &document.Grid{
		HeaderRows: 1, HeaderColumns: 1,
		Rows: [][]document.GridCell{
			{{ColumnSpan: 2, Content: []document.TextRun{{Text: "Merged header"}}}},
			{{RowSpan: 2, Content: []document.TextRun{{Text: "Row header"}}}, {Content: []document.TextRun{{Text: "First"}}}},
			{{Content: []document.TextRun{{Text: "Second"}}}},
		},
	}}
	blocks, err := document.Normalize([]document.Block{input})
	if err != nil {
		t.Fatal(err)
	}
	grid := blocks[0].Table
	if len(grid.ColumnWidths) != 2 || len(grid.Rows[0]) != 1 || len(grid.Rows[2]) != 1 || grid.Rows[0][0].ColumnSpan != 2 || grid.Rows[1][0].RowSpan != 2 {
		t.Fatal("merged cells were padded with overlapping phantom cells")
	}
	stable, err := document.Normalize(blocks)
	if err != nil || !reflect.DeepEqual(stable, blocks) {
		t.Fatal("merged table normalization is not stable")
	}
	for _, rows := range [][][]document.GridCell{
		{{{RowSpan: 2}}},
		{{{}, {RowSpan: 2}}, {{ColumnSpan: 2}}},
		{{{ColumnSpan: document.MaxGridColumns + 1}}},
	} {
		input.Table = &document.Grid{Rows: rows}
		if _, err := document.Normalize([]document.Block{input}); err == nil {
			t.Fatal("invalid merged cell geometry was accepted")
		}
	}
}
