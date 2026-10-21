//go:build integration

package table_test

import (
	"encoding/csv"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/table"
)

func TestTableQueriesUseCompleteDatasetAndStableSnapshots(t *testing.T) {
	def := table.DefaultDefinition()
	numberID := uuid.NewString()
	def.Fields = append(def.Fields, table.Field{ID: numberID, Name: "Order", Kind: "number"})
	def.Views[0].Filters = []table.Filter{{FieldID: numberID, Operator: "gte", Value: float64(9900)}}
	def.Views[0].Sorts = []table.Sort{{FieldID: numberID, Descending: true}}
	def.Views[1].Filters = append([]table.Filter{}, def.Views[0].Filters...)
	literalView := table.View{
		ID:      uuid.NewString(),
		Name:    "Literal substring",
		Kind:    "grid",
		Filters: []table.Filter{{FieldID: def.Fields[0].ID, Operator: "contains", Value: "%_"}},
	}
	def.Views = append(def.Views, literalView)
	f := newTable(t, &def)
	titleID, statusID := def.Fields[0].ID, def.Fields[1].ID
	optionID := def.Fields[1].Options[0].ID
	now := f.env.Clock.Now().UnixMilli()
	if err := f.env.DB.Exec(
		`WITH seed AS (SELECT gen_random_uuid() AS id,n FROM generate_series(1,10000) n),
identities AS (INSERT INTO data_table_record_ids (table_id,record_id,created_at_ms) SELECT CAST(? AS UUID),id,? FROM seed RETURNING record_id)
INSERT INTO data_table_record_versions (table_id,record_id,valid_from,values,updated_at_ms)
SELECT CAST(? AS UUID),seed.id,1,jsonb_build_object(CAST(? AS TEXT),CASE WHEN n=10000 THEN '100%_literal' ELSE 'row '||n END,
CAST(? AS TEXT),n,CAST(? AS TEXT),CASE WHEN n=9999 THEN NULL WHEN n%2=0 THEN CAST(? AS TEXT) ELSE CAST(? AS TEXT) END),?
FROM seed JOIN identities ON identities.record_id=seed.id`,
		f.state.TableID,
		now,
		f.state.TableID,
		titleID,
		numberID,
		statusID,
		optionID,
		def.Fields[1].Options[1].ID,
		now,
	).Error; err != nil {
		t.Fatal(err)
	}
	first := f.records(t, "?page_size=20")
	if first.Pagination.Total != 101 || len(first.Items) != 20 || first.Items[0].Values[numberID] != float64(10000) {
		t.Fatal("filter or numeric ordering did not cover the full dataset")
	}
	second := f.records(t, "?page=2&page_size=20")
	if second.Items[0].Values[numberID] != float64(9980) {
		t.Fatal("second page is not stable")
	}
	grouped := f.records(t, "?view_id="+def.Views[1].ID+"&group_id="+optionID)
	if grouped.Pagination.Total != 51 || len(grouped.Groups) != 4 || grouped.Groups[0].Count != 1 || grouped.Groups[1].Count != 51 || grouped.Groups[2].Count != 49 {
		t.Fatalf("full group statistics are incorrect: %+v", grouped.Groups)
	}
	empty := f.records(t, "?view_id="+def.Views[1].ID+"&group_id=none")
	if empty.Pagination.Total != 1 {
		t.Fatal("null group filtering failed")
	}
	literal := f.records(t, "?view_id="+literalView.ID)
	if literal.Pagination.Total != 1 || literal.Items[0].Values[titleID] != "100%_literal" {
		t.Fatal("contains treated percent or underscore as SQL wildcards")
	}
	f.env.Call(
		t,
		"GET",
		f.path+"/records?group_id=none",
		f.session.AccessToken,
		nil,
		422,
	)
	id := first.Items[0].ID
	f.mutate(t, table.Changes{Upserts: []table.Upsert{{ID: id, Values: map[string]any{titleID: "Edited"}}}})
	frozen := f.records(t, "?document_version=3&page_size=20")
	if frozen.Items[0].Values[titleID] != "100%_literal" {
		t.Fatal("fixed document version drifted after an edit")
	}
	var versions int64
	if err := f.env.DB.Table("data_table_record_versions").Where("table_id=?", f.state.TableID).Count(&versions).Error; err != nil {
		t.Fatal(err)
	}
	if versions != 10001 {
		t.Fatalf("one edit wrote %d temporal records for a 10000-record table", versions)
	}
}

func TestTableExportsPreserveViewOrderAndEscapeContent(t *testing.T) {
	def := table.DefaultDefinition()
	def.Title = "Table <script>"
	def.Fields[0].Name = "=Title"
	descriptionID := uuid.NewString()
	def.Fields = append(def.Fields, table.Field{ID: descriptionID, Name: "Description", Kind: "text"})
	def.Views[0].FieldIDs = []string{descriptionID, def.Fields[0].ID, def.Fields[2].ID}
	f := newTable(t, &def)
	f.mutate(
		t,
		table.Changes{Upserts: []table.Upsert{{ID: uuid.NewString(), Values: map[string]any{descriptionID: "<img> | **bold**\nnext", def.Fields[0].ID: "  =1+1", def.Fields[2].ID: float64(0)}}}},
	)
	csvResult := export(t, f, "GET", "csv")
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(csvResult.Body), "\ufeff"))).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if rows[0][0] != "Description" || rows[0][1] != "'=Title" || rows[1][1] != "'  =1+1" || rows[1][2] != "1970-01-01T08:00+08:00" {
		t.Fatalf("CSV projection is incorrect: %v", rows)
	}
	markdown := string(export(t, f, "GET", "markdown").Body)
	if strings.Contains(markdown, "<script>") || strings.Contains(markdown, "<img>") || !strings.Contains(markdown, "\\| \\*\\*bold\\*\\*<br>next") {
		t.Fatal("Markdown projection is unsafe or loses formatting")
	}
	head := export(t, f, "HEAD", "csv")
	if len(head.Body) != 0 || head.Header.Get("Content-Length") == "" {
		t.Fatal("export HEAD response has incorrect body semantics")
	}
}

func TestTableExportBudgetFailsWithoutTruncatedOutput(t *testing.T) {
	f := newTable(t, nil)
	field := f.meta(t, "").Definition.Fields[0].ID
	now := f.env.Clock.Now().UnixMilli()
	if err := f.env.DB.Exec(
		`WITH seed AS (SELECT gen_random_uuid() AS id FROM generate_series(1,1100)),
identities AS (INSERT INTO data_table_record_ids (table_id,record_id,created_at_ms) SELECT CAST(? AS UUID),id,? FROM seed RETURNING record_id)
INSERT INTO data_table_record_versions (table_id,record_id,valid_from,values,updated_at_ms)
SELECT CAST(? AS UUID),record_id,1,jsonb_build_object(CAST(? AS TEXT),repeat('"',8192)),? FROM identities`,
		f.state.TableID,
		now,
		f.state.TableID,
		field,
		now,
	).Error; err != nil {
		t.Fatal(err)
	}
	response := f.env.Call(
		t,
		"GET",
		f.path+"/export?format=csv",
		f.session.AccessToken,
		nil,
		422,
	)
	if response.Code != "TABLE_EXPORT_TOO_LARGE" || response.Header.Get("Content-Disposition") != "" {
		t.Fatal("oversized export started an attachment instead of returning a complete error")
	}
	_, blockID, path := placeholder(t, f)
	response = f.env.Call(
		t,
		"POST",
		path+"/tables",
		f.session.AccessToken,
		table.CreateInput{
			OperationID: uuid.NewString(), ExpectedDocumentVersion: 2, BlockID: blockID,
			Source: &table.Source{WorkspaceID: f.wid, DocumentID: f.did, TableID: f.state.TableID},
		},
		422,
	)
	if response.Code != "TABLE_COPY_TOO_LARGE" {
		t.Fatal("oversized copy did not enforce its complete snapshot budget")
	}
}

func TestTableInitializationChecksExpandedDocumentSize(t *testing.T) {
	f := newTable(t, nil)
	blockID := uuid.NewString()
	blocks, err := document.Normalize([]document.Block{{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: ""}}}, {ID: blockID, Type: "data_table"}})
	if err != nil {
		t.Fatal(err)
	}
	baseline, err := json.Marshal(blocks)
	if err != nil {
		t.Fatal(err)
	}
	blocks[0].Content[0].Text = strings.Repeat("x", document.MaxContentBytes-len(baseline))
	f.env.Call(
		t,
		"PUT",
		f.docPath+"/content",
		f.session.AccessToken,
		map[string]any{"operation_id": uuid.NewString(), "expected_version": 3, "title": "At the size limit", "blocks": blocks},
		200,
	)
	result := f.env.Call(
		t,
		"POST",
		f.docPath+"/tables",
		f.session.AccessToken,
		table.CreateInput{OperationID: uuid.NewString(), ExpectedDocumentVersion: 4, BlockID: blockID},
		413,
	)
	if result.Code != "CONTENT_TOO_LARGE" {
		t.Fatal("initialization bypassed the document size budget")
	}
	var count int64
	if err := f.env.DB.Table("data_tables").Where("document_id=?", f.did).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("oversized reference left a partially initialized table")
	}
}
