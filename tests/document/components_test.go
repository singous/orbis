//go:build integration

package document_test

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/tests/testenv"
)

func TestRichComponentsPersistThroughDocumentHistory(t *testing.T) {
	f := newDocument(t)
	color := "#ab12ef"
	href := "https://example.test/docs"
	scene := `{"version":1,"elements":[{"id":"box","type":"rectangle","x":0,"y":0,"width":100,"height":50,"strokeColor":"#000000"}],"appState":{"viewBackgroundColor":"#ffffff"}}`
	blocks := []document.Block{
		{ID: uuid.NewString(), Type: "callout", Content: []document.TextRun{{Text: "Notice", TextColor: &color}}},
		{ID: uuid.NewString(), Type: "table", Table: &document.Grid{HeaderRows: 1, Rows: [][]document.GridCell{
			{{ColumnSpan: 2, TextColor: &color, Content: []document.TextRun{{Text: "Merged header", Marks: []string{"bold"}}}}},
			{{Content: []document.TextRun{{Text: "Docs", Href: &href}}, Alignment: "center", BackgroundColor: &color}},
		}}},
		{
			ID:    uuid.NewString(),
			Type:  "drawing",
			Props: map[string]any{"scene": scene, "source": map[string]any{"type": "external", "url": "https://example.test/diagram.png"}},
		},
		{
			ID:       uuid.NewString(),
			Type:     "card_group",
			Children: []document.Block{{ID: uuid.NewString(), Type: "card", Props: map[string]any{"title": "Start", "href": href}, Children: []document.Block{block("Card body")}}},
		},
		{
			ID:       uuid.NewString(),
			Type:     "steps",
			Children: []document.Block{{ID: uuid.NewString(), Type: "step", Children: []document.Block{block("Step body")}}},
		},
		{
			ID:       uuid.NewString(),
			Type:     "tabs",
			Children: []document.Block{{ID: uuid.NewString(), Type: "tab", Props: map[string]any{"title": "Linux"}, Children: []document.Block{block("Tab body")}}},
		},
		{
			ID:       uuid.NewString(),
			Type:     "code_group",
			Children: []document.Block{{ID: uuid.NewString(), Type: "code_block", Props: map[string]any{"language": "go"}, Content: []document.TextRun{{Text: "fmt.Println(1)"}}}},
		},
	}
	saved := testenv.Decode[content](t, f.env.Call(
		t,
		"PUT",
		f.path+"/content",
		f.session.AccessToken,
		map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "title": "Rich content", "blocks": blocks},
		200,
	))
	if saved.Blocks[1].Table == nil || len(saved.Blocks[1].Table.Rows[1]) != 2 || saved.Blocks[1].Table.Rows[0][0].ColumnSpan != 2 || saved.Blocks[2].Props["scene"] != scene {
		t.Fatal("rich content did not survive storage")
	}
	f.env.Call(
		t,
		"PUT",
		f.path+"/content",
		f.session.AccessToken,
		map[string]any{"operation_id": uuid.NewString(), "expected_version": 2, "title": "Empty", "blocks": []any{}},
		200,
	)
	restored := testenv.Decode[content](t, f.env.Call(
		t,
		"POST",
		f.path+"/restore",
		f.session.AccessToken,
		map[string]any{"operation_id": uuid.NewString(), "expected_version": 3, "source_version": 2},
		200,
	))
	want, _ := json.Marshal(saved.Blocks)
	actual, _ := json.Marshal(restored.Blocks)
	if string(want) != string(actual) {
		t.Fatal("history restoration changed component content")
	}
	f.env.Call(
		t,
		"GET",
		f.path+"/blocks?version=2&page_size=100",
		f.session.AccessToken,
		nil,
		200,
	)
}
