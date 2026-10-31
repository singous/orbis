package reader

import (
	"strings"
	"testing"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/publicview"
)

func TestGridPreservesMergedCellStylesWidthsAndEscaping(t *testing.T) {
	first, second := 120, 180
	red, background := "red", "#abcdef"
	value := &document.Grid{ColumnWidths: []*int{&first, &second}, HeaderRows: 1, Rows: [][]document.GridCell{{{RowSpan: 1, ColumnSpan: 2, Alignment: "center", TextColor: &red, BackgroundColor: &background, Content: []document.TextRun{{Text: "<script>"}}}}, {{RowSpan: 1, ColumnSpan: 1, Alignment: "left"}, {RowSpan: 1, ColumnSpan: 1, Alignment: "right"}}}}
	var output writer
	grid(&output, value)
	for _, fragment := range []string{`<col style="width:120px">`, `<col style="width:180px">`, `colspan="2"`, `scope="col"`, `text-align:center;color:#dc2626;background-color:#abcdef`, `&lt;script&gt;`} {
		if !strings.Contains(output.String(), fragment) {
			t.Fatalf("renderer lost %s", fragment)
		}
	}
	if strings.Contains(output.String(), "<script>") {
		t.Fatal("cell text was interpreted as HTML")
	}
}
func TestNumberedItemsAndCardGroupsPreserveDeclaredLayout(t *testing.T) {
	var output writer
	blocks(&output, []publicview.Block{{ID: "first", Type: "numbered_list_item", Props: map[string]any{"start": float64(7)}}, {ID: "second", Type: "numbered_list_item", Props: map[string]any{"start": float64(3)}}, {ID: "cards", Type: "card_group", Props: map[string]any{"columns": float64(3)}}}, nil)
	if !strings.Contains(output.String(), `<ol start="7">`) || !strings.Contains(output.String(), `value="3"`) || !strings.Contains(output.String(), `class="cards cards-three"`) {
		t.Fatal("declared numbering or columns changed")
	}
}

func TestRetiredDrawingsDoNotRenderTheirPreview(t *testing.T) {
	var output writer
	blocks(&output, []publicview.Block{
		{ID: "before", Type: "paragraph", Content: []document.TextRun{{Text: "Before"}}},
		{ID: "retired", Type: "drawing", Props: map[string]any{"caption": "Retired caption", "source": map[string]any{"type": "external", "url": "https://example.test/retired.png"}}},
		{ID: "after", Type: "paragraph", Content: []document.TextRun{{Text: "After"}}},
	}, nil)
	if strings.Contains(output.String(), "retired.png") || strings.Contains(output.String(), "Retired caption") || !strings.Contains(output.String(), "Before") || !strings.Contains(output.String(), "After") {
		t.Fatalf("retired drawing changed surrounding content: %s", output.String())
	}
}
