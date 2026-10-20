//go:build integration

package table_test

import (
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/table"
)

func TestDocumentExportPinsTableRevisionAndView(t *testing.T) {
	f := newTable(t, nil)
	def := f.meta(t, "").Definition
	field := def.Fields[0].ID
	row := uuid.NewString()
	f.mutate(t, table.Changes{Upserts: []table.Upsert{{ID: row, Values: map[string]any{field: "snapshot-before"}}}})
	version := f.state.ContentVersion
	f.mutate(t, table.Changes{Upserts: []table.Upsert{{ID: row, Values: map[string]any{field: "snapshot-after"}}}})
	old := f.env.Call(
		t,
		"GET",
		f.docPath+"/export/markdown?version="+strconv.FormatInt(version, 10),
		f.session.AccessToken,
		nil,
		200,
	)
	current := f.env.Call(
		t,
		"GET",
		f.docPath+"/export/markdown",
		f.session.AccessToken,
		nil,
		200,
	)
	if !strings.Contains(string(old.Body), "snapshot-before") || strings.Contains(string(old.Body), "snapshot-after") || !strings.Contains(string(current.Body), "snapshot-after") {
		t.Fatalf("export read mutable table head: %s / %s", old.Body, current.Body)
	}
	def.Views[0].Filters = []table.Filter{{FieldID: field, Operator: "eq", Value: "not-matched"}}
	f.mutate(t, table.Changes{Definition: &def})
	filtered := f.env.Call(
		t,
		"GET",
		f.docPath+"/export/markdown",
		f.session.AccessToken,
		nil,
		200,
	)
	if strings.Contains(string(filtered.Body), "snapshot-after") {
		t.Fatal("document export ignored snapshot view filters")
	}
}
