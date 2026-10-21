//go:build integration

package sheet_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/internal/sharing"
	"orbis.local/orbis/internal/sheet"
	"orbis.local/orbis/tests/testenv"
)

type fixture struct {
	env         *testenv.Environment
	token, path string
	table       sheet.Sheet
}

func setup(t *testing.T) fixture {
	t.Helper()
	e := testenv.New(t)
	session, wid := e.Owner(t)
	base := "/api/v1/workspaces/" + wid
	collection := testenv.Decode[struct{ ID string }](t, e.Call(t, "POST", base+"/collections", session.AccessToken, map[string]any{"title": "Tables"}, 201))
	in := sheet.Create{ID: uuid.NewString(), CollectionID: collection.ID, Title: "Projects", Template: "tasks"}
	table := testenv.Decode[sheet.Sheet](t, e.Call(t, "POST", base+"/sheets", session.AccessToken, in, 201))
	return fixture{e, session.AccessToken, base + "/sheets/" + table.ID, table}
}
func (f fixture) change(t *testing.T, patches ...sheet.Patch) sheet.ChangeResult {
	t.Helper()
	return testenv.Decode[sheet.ChangeResult](t, f.env.Call(t, "POST", f.path+"/changes", f.token, sheet.Changes{OperationID: uuid.NewString(), SchemaVersion: f.table.SchemaVersion, Records: patches}, 200))
}
func (f fixture) page(t *testing.T, suffix string) sheet.Page {
	t.Helper()
	return testenv.Decode[sheet.Page](t, f.env.Call(t, "GET", f.path+"/records"+suffix, f.token, nil, 200))
}
func TestRecordIsolationReceiptsAndAtomicBatch(t *testing.T) {
	f := setup(t)
	field := f.table.Definition.Fields[0].ID
	a, b := uuid.NewString(), uuid.NewString()
	in := sheet.Changes{OperationID: uuid.NewString(), SchemaVersion: 1, Records: []sheet.Patch{{ID: a, Values: map[string]any{field: "A"}}, {ID: b, Values: map[string]any{field: "B"}}}}
	f.env.Call(t, "POST", f.path+"/changes", f.token, in, 200)
	f.env.Call(t, "POST", f.path+"/changes", f.token, in, 200)
	if len(f.page(t, "").Items) != 2 {
		t.Fatal("retry duplicated records")
	}
	f.change(t, sheet.Patch{ID: a, Version: 1, Values: map[string]any{field: "Changed"}})
	f.change(t, sheet.Patch{ID: b, Version: 1, Values: map[string]any{field: "Independent"}})
	bad := sheet.Changes{OperationID: uuid.NewString(), SchemaVersion: 1, Records: []sheet.Patch{{ID: a, Version: 1, Values: map[string]any{field: "Lost"}}, {ID: b, Version: 2, Values: map[string]any{field: "Partial"}}}}
	f.env.Call(t, "POST", f.path+"/changes", f.token, bad, 409)
	for _, row := range f.page(t, "").Items {
		if row.Values[field] == "Lost" || row.Values[field] == "Partial" {
			t.Fatal("conflicting batch partially committed")
		}
	}
}
func TestCursorSortsAndSchemaInvalidation(t *testing.T) {
	f := setup(t)
	field := f.table.Definition.Fields[0].ID
	patches := []sheet.Patch{}
	for _, text := range []string{"C", "A", "B", "D", "E"} {
		patches = append(patches, sheet.Patch{ID: uuid.NewString(), Values: map[string]any{field: text}})
	}
	f.change(t, patches...)
	d := f.table.Definition
	d.Views[0].Sorts = []sheet.Sort{{FieldID: field}}
	f.table = testenv.Decode[sheet.Sheet](t, f.env.Call(t, "PUT", f.path, f.token, sheet.Update{Version: 1, Title: f.table.Title, Definition: d}, 200))
	page := f.page(t, "?limit=2")
	if len(page.Items) != 2 || page.Items[0].Values[field] != "A" || page.NextCursor == "" {
		t.Fatalf("bad first page: %+v", page)
	}
	next := f.page(t, "?limit=2&cursor="+url.QueryEscape(page.NextCursor))
	if next.Items[0].Values[field] != "C" {
		t.Fatal("cursor duplicated or skipped records")
	}
	f.env.Call(t, "PUT", f.path, f.token, sheet.Update{Version: 2, Title: "Renamed", Definition: d}, 200)
	f.env.Call(t, "GET", f.path+"/records?cursor="+url.QueryEscape(page.NextCursor), f.token, nil, 422)
}
func TestPublicFormScopeRetryAndStop(t *testing.T) {
	f := setup(t)
	field := f.table.Definition.Fields[0].ID
	form := sheet.Form{ID: uuid.NewString(), SheetID: f.table.ID, Enabled: true, Config: sheet.FormConfig{Title: "Collect", Description: "", Fields: []sheet.FormField{{FieldID: field, Required: true}}}}
	form = testenv.Decode[sheet.Form](t, f.env.Call(t, "PUT", f.path+"/forms", f.token, form, 200))
	public := "/api/v1/public/forms/" + form.Token
	f.env.Call(t, "GET", public, "", nil, 200)
	in := sheet.Submission{OperationID: uuid.NewString(), Version: form.Version, Values: map[string]any{field: "Submitted"}}
	f.env.Call(t, "POST", public+"/submissions", "", in, 200)
	f.env.Call(t, "POST", public+"/submissions", "", in, 200)
	if len(f.page(t, "").Items) != 1 {
		t.Fatal("submission retry duplicated record")
	}
	form.Config.Title = "Updated form"
	form = testenv.Decode[sheet.Form](t, f.env.Call(t, "PUT", f.path+"/forms", f.token, form, 200))
	f.env.Call(t, "POST", public+"/submissions", "", in, 200)
	in.OperationID = uuid.NewString()
	in.Version = form.Version
	in.Values[f.table.Definition.Fields[1].ID] = "private"
	f.env.Call(t, "POST", public+"/submissions", "", in, 422)
	form.Enabled = false
	f.env.Call(t, "PUT", f.path+"/forms", f.token, form, 200)
	f.env.Call(t, "GET", public, "", nil, 404)
	f.env.Call(t, "POST", public+"/submissions", "", in, 404)
}

func TestFieldCopyIncludesRecordsOutsideFirstPage(t *testing.T) {
	f := setup(t)
	source := f.table.Definition.Fields[0]
	patches := []sheet.Patch{}
	for i := 0; i < 150; i++ {
		patches = append(patches, sheet.Patch{ID: uuid.NewString(), Values: map[string]any{source.ID: fmt.Sprint(i)}})
	}
	f.change(t, patches...)
	copied := source
	copied.ID = uuid.NewString()
	copied.Name = "Copy"
	copied.CopyFrom = source.ID
	d := f.table.Definition
	d.Fields = append(d.Fields, copied)
	d.Views[0].FieldIDs = append(d.Views[0].FieldIDs, copied.ID)
	f.table = testenv.Decode[sheet.Sheet](t, f.env.Call(t, "PUT", f.path, f.token, sheet.Update{Version: 1, Title: f.table.Title, Definition: d}, 200))
	page := f.page(t, "")
	next := f.page(t, "?cursor="+url.QueryEscape(page.NextCursor))
	if len(next.Items) != 50 {
		t.Fatal("second page missing")
	}
	for _, row := range next.Items {
		if row.Values[copied.ID] != row.Values[source.ID] {
			t.Fatal("copy omitted unloaded records")
		}
	}
}

func TestLargeTableQueryBudgets(t *testing.T) {
	if testing.Short() {
		t.Skip("large-table query profile")
	}
	f := setup(t)
	d := f.table.Definition
	d.Fields[0].Kind = "number"
	field := d.Fields[0].ID
	f.table = testenv.Decode[sheet.Sheet](t, f.env.Call(t, "PUT", f.path, f.token, sheet.Update{Version: 1, Title: f.table.Title, Definition: d}, 200))
	if err := f.env.DB.Exec("INSERT INTO sheet_records(sheet_id,id,version,values,created_at_ms,updated_at_ms) SELECT ?,gen_random_uuid(),1,jsonb_build_object(?::text,n),1,1 FROM generate_series(1,100000) n", f.table.ID, field).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.env.DB.Exec("INSERT INTO sheet_cells(sheet_id,record_id,field_id,number_value) SELECT sheet_id,id,?,(values->>?)::numeric FROM sheet_records WHERE sheet_id=?", field, field, f.table.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.env.DB.Exec("UPDATE sheet_activity SET record_count=100000,revision=1 WHERE sheet_id=?", f.table.ID).Error; err != nil {
		t.Fatal(err)
	}
	f.env.DB.Exec("ANALYZE sheet_records")
	f.env.DB.Exec("ANALYZE sheet_cells")
	start := time.Now()
	page := f.page(t, "")
	t.Logf("100k rows, default first page: %s", time.Since(start))
	if len(page.Items) != 100 {
		t.Fatal("unbounded or incomplete page")
	}
	raw, _ := base64.RawURLEncoding.DecodeString(page.NextCursor)
	var cursor map[string]any
	if err := json.Unmarshal(raw, &cursor); err != nil {
		t.Fatal(err)
	}
	var near struct {
		ID       string
		Position int64
	}
	f.env.DB.Table("sheet_records").Select("id,position").Where("sheet_id=?", f.table.ID).Order("position").Offset(90000).Limit(1).Scan(&near)
	cursor["id"] = near.ID
	cursor["k"] = []any{near.Position, near.ID}
	raw, _ = json.Marshal(cursor)
	start = time.Now()
	f.page(t, "?cursor="+base64.RawURLEncoding.EncodeToString(raw))
	t.Logf("100k rows, keyset page beyond 90k: %s", time.Since(start))
	d.Views[0].Sorts = []sheet.Sort{{FieldID: field}}
	d.Views[0].Filters = []sheet.Filter{{FieldID: field, Operator: "gte", Value: float64(99900)}}
	f.env.Call(t, "PUT", f.path, f.token, sheet.Update{Version: 2, Title: f.table.Title, Definition: d}, 200)
	start = time.Now()
	page = f.page(t, "")
	t.Logf("100k rows, indexed numeric filter + sort: %s", time.Since(start))
	if page.Items[0].Values[field] != float64(99900) {
		t.Fatal("numeric filtering or sorting is incorrect")
	}
}

func TestConcurrentIndependentRecordsCommit(t *testing.T) {
	f := setup(t)
	field := f.table.Definition.Fields[0].ID
	a, b := uuid.NewString(), uuid.NewString()
	f.change(t, sheet.Patch{ID: a, Values: map[string]any{field: "A"}}, sheet.Patch{ID: b, Values: map[string]any{field: "B"}})
	results := make(chan int, 2)
	start := make(chan struct{})
	for _, id := range []string{a, b} {
		go func(id string) {
			<-start
			body, _ := json.Marshal(sheet.Changes{OperationID: uuid.NewString(), SchemaVersion: 1, Records: []sheet.Patch{{ID: id, Version: 1, Values: map[string]any{field: "updated"}}}})
			req := httptest.NewRequest("POST", f.path+"/changes", bytes.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+f.token)
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			f.env.Handler.ServeHTTP(rec, req)
			results <- rec.Code
		}(id)
	}
	close(start)
	for range 2 {
		if code := <-results; code != 200 {
			t.Fatalf("independent writer failed: %d", code)
		}
	}
	current := testenv.Decode[sheet.Sheet](t, f.env.Call(t, "GET", f.path, f.token, nil, 200))
	if current.Version != 1 || current.DataRevision != 3 {
		t.Fatalf("schema/data revisions conflated: %+v", current)
	}
}
func TestDocumentReferenceDoesNotGrantPublicRead(t *testing.T) {
	f := setup(t)
	field := f.table.Definition.Fields[0].ID
	f.change(t, sheet.Patch{ID: uuid.NewString(), Values: map[string]any{field: "public value", f.table.Definition.Fields[1].ID: f.table.Definition.Fields[1].Options[0].ID}})
	d := f.table.Definition
	d.Views[0].FieldIDs = []string{field}
	f.env.Call(t, "PUT", f.path, f.token, sheet.Update{Version: 1, Title: f.table.Title, Definition: d}, 200)
	base := "/api/v1/workspaces/" + f.table.WorkspaceID
	doc := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", base+"/collections/"+f.table.CollectionID+"/documents", f.token, map[string]any{"title": "Embedded"}, 201))
	f.env.Call(t, "PUT", base+"/documents/"+doc.ID+"/content", f.token, map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "title": "Embedded", "blocks": []document.Block{{ID: uuid.NewString(), Type: "data_table", Props: map[string]any{"sheet_id": f.table.ID, "sheet_view_id": d.Views[0].ID}}}}, 200)
	share := testenv.Decode[struct{ Token string }](t, f.env.Call(t, "POST", base+"/shares", f.token, sharing.CreateInput{CollectionID: f.table.CollectionID, RootDocumentID: &doc.ID, AcknowledgePublicScope: true}, 201))
	result := f.env.Call(t, "GET", "/api/v1/public/shares/"+share.Token+"/documents/"+doc.ID+"/content", "", nil, 200)
	if strings.Contains(string(result.Data), "public value") || strings.Contains(string(result.Data), "待开始") || !strings.Contains(string(result.Data), `"restricted":true`) {
		t.Fatal("a document share granted access to an independent table")
	}
}

func TestViewConfigurationDoesNotInvalidateRecordEdits(t *testing.T) {
	f := setup(t)
	id := uuid.NewString()
	field := f.table.Definition.Fields[0].ID
	f.change(t, sheet.Patch{ID: id, Values: map[string]any{field: "before"}})
	d := f.table.Definition
	d.Views[0].Widths[field] = 320
	f.env.Call(t, "PUT", f.path, f.token, sheet.Update{Version: 1, Title: f.table.Title, Definition: d}, 200)
	f.change(t, sheet.Patch{ID: id, Version: 1, Values: map[string]any{field: "after"}})
	if f.page(t, "").Items[0].Values[field] != "after" {
		t.Fatal("view settings blocked record editing")
	}
}

func TestLongTextIsStoredAndFilteredWithoutOversizedIndexKeys(t *testing.T) {
	f := setup(t)
	field := f.table.Definition.Fields[0].ID
	value := strings.Repeat("长文本", 2000)
	f.change(t, sheet.Patch{ID: uuid.NewString(), Values: map[string]any{field: value}})
	d := f.table.Definition
	d.Views[0].Filters = []sheet.Filter{{FieldID: field, Operator: "eq", Value: value}}
	f.env.Call(t, "PUT", f.path, f.token, sheet.Update{Version: 1, Title: f.table.Title, Definition: d}, 200)
	page := f.page(t, "")
	if len(page.Items) != 1 || page.Items[0].Values[field] != value {
		t.Fatal("long text was truncated or failed indexed equality")
	}
}

func TestPublishedReferenceFreezesSelectedData(t *testing.T) {
	f := setup(t)
	field := f.table.Definition.Fields[0].ID
	record := uuid.NewString()
	f.change(t, sheet.Patch{ID: record, Values: map[string]any{field: "Published value"}})
	definition := f.table.Definition
	definition.Views[0].FieldIDs = []string{field}
	f.env.Call(t, "PUT", f.path, f.token, sheet.Update{Version: 1, Title: f.table.Title, Definition: definition}, 200)
	base := "/api/v1/workspaces/" + f.table.WorkspaceID
	doc := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", base+"/collections/"+f.table.CollectionID+"/documents", f.token, map[string]any{"title": "Reference"}, 201))
	f.env.Call(t, "PUT", base+"/documents/"+doc.ID+"/content", f.token, map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "title": "Reference", "blocks": []document.Block{{ID: uuid.NewString(), Type: "data_table", Props: map[string]any{"sheet_id": f.table.ID, "sheet_view_id": definition.Views[0].ID}}}}, 200)
	site := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", base+"/sites", f.token, publishing.Config{Name: "Reference site", Slug: "sheet-records", Navigation: []publishing.Navigation{{DocumentID: doc.ID, Slug: "records", Title: "Records"}}}, 201))
	path := base + "/sites/" + site.ID
	preview := testenv.Decode[publishing.Preview](t, f.env.Call(t, "GET", path+"/preview", f.token, nil, 200))
	f.env.Call(t, "POST", path+"/publish", f.token, publishing.PublishInput{OperationID: uuid.NewString(), ExpectedVersion: 1, ExpectedSourceFingerprint: preview.SourceFingerprint}, 201)
	f.change(t, sheet.Patch{ID: record, Version: 1, Values: map[string]any{field: "Unpublished value"}})
	page := f.env.Call(t, "GET", "/api/v1/public/sites/sheet-records/pages/records", "", nil, 200)
	if !strings.Contains(string(page.Data), "Published value") || strings.Contains(string(page.Data), "Unpublished value") {
		t.Fatal("published table changed with live records")
	}
	next := testenv.Decode[publishing.Preview](t, f.env.Call(t, "GET", path+"/preview", f.token, nil, 200))
	if preview.SourceFingerprint == next.SourceFingerprint {
		t.Fatal("table changes were absent from the publication fingerprint")
	}
}
