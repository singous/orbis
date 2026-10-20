package table_test

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/table"
)

func TestDefinitionAndCellValidation(t *testing.T) {
	def := table.DefaultDefinition()
	before, _ := json.Marshal(def)
	normalized, err := table.NormalizeDefinition(def)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(def)
	if !bytes.Equal(before, after) {
		t.Fatal("definition normalization mutated input")
	}
	for _, test := range []struct {
		kind  string
		value any
		valid bool
	}{
		{"number", float64(0), true}, {"number", true, false}, {"number", float64(table.MaxVersion) + 1, false},
		{"datetime", float64(0), true}, {"datetime", 1.5, false}, {"datetime", float64(table.MaxDatetime) + 1, false},
		{"checkbox", false, true}, {"checkbox", "false", false}, {"text", nil, true}, {"text", "a\x00b", false},
		{"url", "mailto:user@example.test", true}, {"url", "https://example.test/", true}, {"url", "javascript:alert(1)", false}, {"url", "https://user:password@example.test/", false},
	} {
		if err := table.ValidateValue(table.Field{Kind: test.kind}, test.value); (err == nil) != test.valid {
			t.Fatalf("%s value %v validation: %v", test.kind, test.value, err)
		}
	}
	normalized.Views[1].GroupFieldID = nil
	if _, err := table.NormalizeDefinition(normalized); err == nil {
		t.Fatal("kanban without grouping accepted")
	}
}
func TestTableCopyRemapsStructureAndPreservesAuthoredUUIDText(t *testing.T) {
	original := table.DefaultDefinition()
	textID, statusID := original.Fields[0].ID, original.Fields[1].ID
	optionID := original.Fields[1].Options[0].ID
	original.Views[0].Filters = []table.Filter{{FieldID: statusID, Operator: "eq", Value: optionID}}
	copyDef, rows, err := table.Copy(original, []table.Record{{ID: uuid.NewString(), Values: map[string]any{textID: optionID, statusID: optionID}}})
	if err != nil {
		t.Fatal(err)
	}
	if copyDef.Fields[0].ID == textID || copyDef.Fields[1].Options[0].ID == optionID || copyDef.Views[0].ID == original.Views[0].ID {
		t.Fatal("structural identities were reused")
	}
	if rows[0].Values[copyDef.Fields[0].ID] != optionID {
		t.Fatal("UUID-shaped text was rewritten")
	}
	if rows[0].Values[copyDef.Fields[1].ID] != copyDef.Fields[1].Options[0].ID || copyDef.Views[0].Filters[0].Value != copyDef.Fields[1].Options[0].ID {
		t.Fatal("select references were not remapped")
	}
	if _, err := table.NormalizeDefinition(copyDef); err != nil {
		t.Fatal(err)
	}
}
func TestExportEscapingAndEncodedSizeBudget(t *testing.T) {
	projection := table.Projection{
		Title:   "<script>",
		View:    "View",
		Version: 1,
		Columns: []string{"=formula", "Text"},
		Rows:    [][]string{{"  +SUM(1,2)", "<img> | **bold**\nnext"}},
	}
	data, err := table.RenderExport(projection, "csv")
	if err != nil {
		t.Fatal(err)
	}
	reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(data), "\ufeff")))
	rows, err := reader.ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if rows[0][0] != "'=formula" || rows[1][0] != "'  +SUM(1,2)" {
		t.Fatal("CSV formula prefixes were not neutralized")
	}
	data, err = table.RenderExport(projection, "markdown")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "<script>") || strings.Contains(string(data), "<img>") || !strings.Contains(string(data), "\\| \\*\\*bold\\*\\*<br>next") {
		t.Fatal("Markdown escaping is incorrect")
	}
	large := table.Projection{Columns: []string{"Text"}, Rows: [][]string{{strings.Repeat(`"`, table.MaxTransferBytes/2+1)}}}
	if _, err := table.RenderExport(large, "csv"); err == nil {
		t.Fatal("encoded CSV exceeded its budget without failing")
	}
	if got := table.Display(table.Field{Kind: "datetime"}, float64(0)); got != "1970-01-01T08:00+08:00" {
		t.Fatalf("datetime display timezone: %s", got)
	}
}
