//go:build integration

package table_test

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/table"
	"orbis.local/orbis/tests/testenv"
)

type metadata struct {
	TableID        string           `json:"table_id"`
	BlockID        string           `json:"block_id"`
	TableVersion   int64            `json:"table_version"`
	ContentVersion int64            `json:"content_version"`
	Definition     table.Definition `json:"definition"`
	CreatedAtMS    int64            `json:"created_at_ms"`
	UpdatedAtMS    int64            `json:"updated_at_ms"`
}
type recordPage struct {
	Table      metadata       `json:"table"`
	Items      []table.Record `json:"items"`
	Groups     []table.Group  `json:"groups"`
	Pagination struct {
		Page     int
		PageSize int `json:"page_size"`
		Total    int64
	} `json:"pagination"`
}
type fixture struct {
	env                                                 *testenv.Environment
	session                                             testenv.Session
	wid, cid, did, blockID, otherBlockID, docPath, path string
	state                                               table.Result
	create                                              table.CreateInput
}

func newTable(t *testing.T, definition *table.Definition) fixture {
	t.Helper()
	env := testenv.New(t)
	session, wid := env.Owner(t)
	return createTableFixture(t, env, session, wid, definition)
}
func createTableFixture(t *testing.T, env *testenv.Environment, session testenv.Session, wid string, definition *table.Definition) fixture {
	t.Helper()
	base := "/api/v1/workspaces/" + wid
	collection := testenv.Decode[struct{ ID string }](t, env.Call(
		t,
		"POST",
		base+"/collections",
		session.AccessToken,
		map[string]any{"title": "Tables"},
		201,
	))
	doc := testenv.Decode[struct{ ID string }](t, env.Call(
		t,
		"POST",
		base+"/collections/"+collection.ID+"/documents",
		session.AccessToken,
		map[string]any{"title": "Data"},
		201,
	))
	f := fixture{
		env:          env,
		session:      session,
		wid:          wid,
		cid:          collection.ID,
		did:          doc.ID,
		blockID:      uuid.NewString(),
		otherBlockID: uuid.NewString(),
		docPath:      base + "/documents/" + doc.ID,
	}
	env.Call(
		t,
		"PUT",
		f.docPath+"/content",
		session.AccessToken,
		map[string]any{
			"operation_id":     uuid.NewString(),
			"expected_version": 1,
			"title":            "Data",
			"blocks":           []document.Block{{ID: f.blockID, Type: "data_table"}, {ID: f.otherBlockID, Type: "paragraph", Content: []document.TextRun{{Text: "Unrelated"}}}},
		},
		200,
	)
	f.create = table.CreateInput{OperationID: uuid.NewString(), ExpectedDocumentVersion: 2, BlockID: f.blockID, Definition: definition}
	f.state = testenv.Decode[table.Result](t, env.Call(
		t,
		"POST",
		f.docPath+"/tables",
		session.AccessToken,
		f.create,
		201,
	))
	f.path = f.docPath + "/tables/" + f.state.TableID
	return f
}
func (f fixture) meta(t *testing.T, suffix string) metadata {
	t.Helper()
	return testenv.Decode[metadata](t, f.env.Call(
		t,
		"GET",
		f.path+suffix,
		f.session.AccessToken,
		nil,
		200,
	))
}
func (f fixture) records(t *testing.T, suffix string) recordPage {
	t.Helper()
	return testenv.Decode[recordPage](t, f.env.Call(
		t,
		"GET",
		f.path+"/records"+suffix,
		f.session.AccessToken,
		nil,
		200,
	))
}
func (f fixture) input(changes table.Changes) table.MutationInput {
	return table.MutationInput{
		OperationID:             uuid.NewString(),
		ExpectedDocumentVersion: f.state.ContentVersion,
		ExpectedTableVersion:    f.state.TableVersion,
		Changes:                 changes,
	}
}
func (f *fixture) mutate(t *testing.T, changes table.Changes) table.Result {
	t.Helper()
	f.state = testenv.Decode[table.Result](t, f.env.Call(
		t,
		"POST",
		f.path+"/changes",
		f.session.AccessToken,
		f.input(changes),
		200,
	))
	return f.state
}
func (f fixture) find(t *testing.T, page recordPage, id string) table.Record {
	t.Helper()
	for _, row := range page.Items {
		if row.ID == id {
			return row
		}
	}
	t.Fatal("record is missing")
	return table.Record{}
}
func cloneDefinition(t *testing.T, def table.Definition) table.Definition {
	t.Helper()
	data, err := json.Marshal(def)
	if err != nil {
		t.Fatal(err)
	}
	var result table.Definition
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestTableRecordsCommitWithDocumentAndReplay(t *testing.T) {
	f := newTable(t, nil)
	meta := f.meta(t, "")
	textID, statusID := meta.Definition.Fields[0].ID, meta.Definition.Fields[1].ID
	option := meta.Definition.Fields[1].Options[0].ID
	if f.state.ContentVersion != 3 || f.state.TableVersion != 1 || f.state.Inverse != nil {
		t.Fatal("table initialization did not advance the document atomically")
	}
	empty := f.records(t, "")
	if empty.Items == nil || len(empty.Items) != 0 || empty.Groups == nil || empty.Pagination.PageSize != 20 {
		t.Fatal("table page defaults are inconsistent")
	}
	first, second := uuid.NewString(), uuid.NewString()
	input := f.input(table.Changes{Upserts: []table.Upsert{{ID: first, Values: map[string]any{textID: "One", statusID: option}}, {ID: second, Values: map[string]any{textID: "Two"}}}})
	f.state = testenv.Decode[table.Result](t, f.env.Call(
		t,
		"POST",
		f.path+"/changes",
		f.session.AccessToken,
		input,
		200,
	))
	before := f.find(t, f.records(t, ""), first)
	if page := f.records(t, ""); page.Items[0].ID != first || page.Items[1].ID != second {
		t.Fatal("default row order did not preserve insertion order independently of UUID values")
	}
	replay := testenv.Decode[table.Result](t, f.env.Call(
		t,
		"POST",
		f.path+"/changes",
		f.session.AccessToken,
		input,
		200,
	))
	if replay.ContentVersion != f.state.ContentVersion || replay.TableVersion != 2 {
		t.Fatal("identical command was not replayed")
	}
	f.env.Clock.Advance(123 * time.Millisecond)
	f.mutate(t, table.Changes{Upserts: []table.Upsert{{ID: first, Values: map[string]any{textID: "Updated"}}}})
	after := f.find(t, f.records(t, ""), first)
	if after.Values[statusID] != option || after.CreatedAtMS != before.CreatedAtMS || after.UpdatedAtMS != before.UpdatedAtMS+123 {
		t.Fatal("partial update lost cells or audit timestamps")
	}
	page := f.records(t, "?page_size=1")
	if len(page.Items) != 1 || page.Pagination.Total != 2 {
		t.Fatal("record pagination is incorrect")
	}
	var versions, unrelated int64
	if err := f.env.DB.Table("data_table_record_versions").Where("table_id=?", f.state.TableID).Count(&versions).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.env.DB.Table("document_block_versions").Where("document_id=? AND block_id=?", f.did, f.otherBlockID).Count(&unrelated).Error; err != nil {
		t.Fatal(err)
	}
	if versions != 3 || unrelated != 1 {
		t.Fatal("single-record edit rewrote unrelated content")
	}
	createdAgain := testenv.Decode[table.Result](t, f.env.Call(
		t,
		"POST",
		f.docPath+"/tables",
		f.session.AccessToken,
		f.create,
		201,
	))
	if createdAgain.TableID != f.state.TableID || createdAgain.ContentVersion != 3 {
		t.Fatal("creation replay changed identity or result")
	}
	input.Upserts[0].Values[textID] = "different intention"
	conflict := f.env.Call(
		t,
		"POST",
		f.path+"/changes",
		f.session.AccessToken,
		input,
		409,
	)
	if conflict.Code != "IDEMPOTENCY_CONFLICT" {
		t.Fatal("operation ID reuse was not rejected")
	}
	bad := f.input(table.Changes{Deletes: []string{first}})
	bad.ExpectedTableVersion--
	conflict = f.env.Call(
		t,
		"POST",
		f.path+"/changes",
		f.session.AccessToken,
		bad,
		409,
	)
	if conflict.Code != "TABLE_VERSION_CONFLICT" {
		t.Fatal("table reference version was ignored")
	}
	f.env.Call(
		t,
		"GET",
		f.path+"/records?page_size=101",
		f.session.AccessToken,
		nil,
		422,
	)
}

func TestHistoricalTableReferenceBranchesWithoutOverwritingHistory(t *testing.T) {
	f := newTable(t, nil)
	field := f.meta(t, "").Definition.Fields[0].ID
	id, laterID := uuid.NewString(), uuid.NewString()
	f.mutate(t, table.Changes{Upserts: []table.Upsert{{ID: id, Values: map[string]any{field: "Historical"}}}})
	historical := f.state.ContentVersion
	f.mutate(t, table.Changes{Upserts: []table.Upsert{{ID: id, Values: map[string]any{field: "Later"}}, {ID: laterID, Values: map[string]any{field: "Later-only"}}}})
	later := f.state.ContentVersion
	f.env.Call(
		t,
		"PUT",
		f.docPath+"/content",
		f.session.AccessToken,
		map[string]any{"operation_id": uuid.NewString(), "expected_version": later, "title": "Removed table", "blocks": []any{}},
		200,
	)
	f.env.Call(
		t,
		"GET",
		f.path,
		f.session.AccessToken,
		nil,
		404,
	)
	old := f.records(t, "?document_version=4")
	if old.Pagination.Total != 1 || old.Items[0].Values[field] != "Historical" {
		t.Fatal("historical table snapshot was lost")
	}
	f.env.Call(
		t,
		"POST",
		f.docPath+"/restore",
		f.session.AccessToken,
		map[string]any{"operation_id": uuid.NewString(), "expected_version": later + 1, "source_version": historical},
		200,
	)
	meta := f.meta(t, "")
	f.state.ContentVersion = meta.ContentVersion
	f.state.TableVersion = meta.TableVersion
	f.mutate(t, table.Changes{Upserts: []table.Upsert{{ID: id, Values: map[string]any{field: "Branch"}}}})
	if f.state.TableVersion != 4 {
		t.Fatal("restored table did not continue the monotonic revision counter")
	}
	current := f.records(t, "")
	if current.Pagination.Total != 1 || current.Items[0].Values[field] != "Branch" {
		t.Fatal("branch inherited later records")
	}
	frozen := f.records(t, "?document_version=5")
	if frozen.Pagination.Total != 2 || f.find(t, frozen, id).Values[field] != "Later" {
		t.Fatal("branch changed a later historical snapshot")
	}
}

func TestDefinitionChangesOptionsAndUndo(t *testing.T) {
	f := newTable(t, nil)
	def := f.meta(t, "").Definition
	titleID, statusID := def.Fields[0].ID, def.Fields[1].ID
	optionID := def.Fields[1].Options[0].ID
	numberID, checkID, tagID, urlID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	tagOption := uuid.NewString()
	def.Fields = append(
		def.Fields,
		table.Field{ID: numberID, Name: "Amount", Kind: "number"},
		table.Field{ID: checkID, Name: "Done", Kind: "checkbox"},
		table.Field{ID: tagID, Name: "Tags", Kind: "multi_select", Options: []table.Option{{ID: tagOption, Label: "Tag", Color: "blue"}}},
		table.Field{ID: urlID, Name: "URL", Kind: "url"},
	)
	f.mutate(t, table.Changes{Definition: &def})
	id, second := uuid.NewString(), uuid.NewString()
	f.mutate(t, table.Changes{Upserts: []table.Upsert{{
		ID:     id,
		Values: map[string]any{titleID: "Row", statusID: optionID, numberID: 1.5, checkID: true, tagID: []string{tagOption}, urlID: "https://example.test"},
	}, {ID: second, Values: map[string]any{statusID: optionID}}}})
	original := f.find(t, f.records(t, ""), id)
	for _, bad := range []map[string]any{{numberID: true}, {checkID: "true"}, {tagID: []string{"unknown"}}, {urlID: "javascript:alert(1)"}} {
		f.env.Call(
			t,
			"POST",
			f.path+"/changes",
			f.session.AccessToken,
			f.input(table.Changes{Upserts: []table.Upsert{{ID: id, Values: bad}}}),
			422,
		)
	}
	removed := cloneDefinition(t, f.meta(t, "").Definition)
	removed.Fields[1].Options = removed.Fields[1].Options[1:]
	f.env.Call(
		t,
		"POST",
		f.path+"/changes",
		f.session.AccessToken,
		f.input(table.Changes{Definition: &removed}),
		422,
	)
	result := f.mutate(t, table.Changes{Definition: &removed, Upserts: []table.Upsert{{ID: id, Values: map[string]any{statusID: nil}}}, Deletes: []string{second}})
	if result.Inverse == nil {
		t.Fatal("inverse change set was not returned")
	}
	f.mutate(t, *result.Inverse)
	if f.find(t, f.records(t, ""), id).Values[statusID] != optionID || f.find(t, f.records(t, ""), id).CreatedAtMS != original.CreatedAtMS {
		t.Fatal("inverse did not restore record values and identity")
	}
	hidden := cloneDefinition(t, f.meta(t, "").Definition)
	fields := []table.Field{}
	for _, field := range hidden.Fields {
		if field.ID != numberID {
			fields = append(fields, field)
		}
	}
	hidden.Fields = fields
	f.mutate(t, table.Changes{Definition: &hidden})
	changed := f.mutate(t, table.Changes{Upserts: []table.Upsert{{ID: id, Values: map[string]any{checkID: false}}}})
	f.mutate(t, *changed.Inverse)
	row := f.find(t, f.records(t, ""), id)
	if _, exists := row.Values[numberID]; exists {
		t.Fatal("removed field leaked through record projection")
	}
	if row.Values[checkID] != true {
		t.Fatal("hidden values broke undo")
	}
	invalid := cloneDefinition(t, hidden)
	invalid.Fields = append(invalid.Fields, table.Field{ID: numberID, Name: "Wrong type", Kind: "text"})
	f.env.Call(
		t,
		"POST",
		f.path+"/changes",
		f.session.AccessToken,
		f.input(table.Changes{Definition: &invalid}),
		422,
	)
}

func TestConcurrentTableCommandsAndReceiptRollback(t *testing.T) {
	f := newTable(t, nil)
	field := f.meta(t, "").Definition.Fields[0].ID
	id := uuid.NewString()
	input := f.input(table.Changes{Upserts: []table.Upsert{{ID: id, Values: map[string]any{field: "One command"}}}})
	type outcome struct {
		result testenv.Result
		err    error
	}
	results := make(chan outcome, 2)
	var workers sync.WaitGroup
	for range 2 {
		workers.Go(func() {
			result, err := f.env.Do("POST", f.path+"/changes", f.session.AccessToken, input)
			results <- outcome{result: result, err: err}
		})
	}
	workers.Wait()
	close(results)
	for result := range results {
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.result.Status != 200 {
			t.Fatalf("identical command status: %d", result.result.Status)
		}
		f.state = testenv.Decode[table.Result](t, result.result)
	}
	if f.state.TableVersion != 2 {
		t.Fatal("duplicate command created more than one revision")
	}
	before := f.state
	if err := f.env.DB.Exec("ALTER TABLE data_table_operations ADD CONSTRAINT test_reject_table_receipt CHECK ((result->>'table_version')::bigint <= 2) NOT VALID").Error; err != nil {
		t.Fatal(err)
	}
	next := f.input(table.Changes{Upserts: []table.Upsert{{ID: id, Values: map[string]any{field: "Rollback"}}}})
	f.env.Call(
		t,
		"POST",
		f.path+"/changes",
		f.session.AccessToken,
		next,
		500,
	)
	meta := f.meta(t, "")
	if meta.ContentVersion != before.ContentVersion || meta.TableVersion != before.TableVersion || f.find(t, f.records(t, ""), id).Values[field] != "One command" {
		t.Fatal("receipt failure partially committed table data")
	}
	if err := f.env.DB.Exec("ALTER TABLE data_table_operations DROP CONSTRAINT test_reject_table_receipt").Error; err != nil {
		t.Fatal(err)
	}
	f.state = testenv.Decode[table.Result](t, f.env.Call(
		t,
		"POST",
		f.path+"/changes",
		f.session.AccessToken,
		next,
		200,
	))
	results = make(chan outcome, 2)
	for _, value := range []string{"First", "Second"} {
		input := f.input(table.Changes{Upserts: []table.Upsert{{ID: id, Values: map[string]any{field: value}}}})
		workers.Go(func() {
			result, err := f.env.Do("POST", f.path+"/changes", f.session.AccessToken, input)
			results <- outcome{result: result, err: err}
		})
	}
	workers.Wait()
	close(results)
	statuses := map[int]int{}
	for result := range results {
		if result.err != nil {
			t.Fatal(result.err)
		}
		statuses[result.result.Status]++
	}
	if statuses[200] != 1 || statuses[409] != 1 {
		t.Fatalf("competing table edits: %v", statuses)
	}
}

func export(t *testing.T, f fixture, method, format string) testenv.Result {
	t.Helper()
	request := httptest.NewRequest(method, f.path+"/export?format="+format, nil)
	request.Header.Set("Authorization", "Bearer "+f.session.AccessToken)
	result, err := f.env.DoRequest(request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != 200 {
		t.Fatalf("export status=%d code=%s", result.Status, result.Code)
	}
	return result
}

func TestMixedBatchUndoUsesBoundedHistoricalReferences(t *testing.T) {
	f := newTable(t, nil)
	field := f.meta(t, "").Definition.Fields[0].ID
	ids := make([]string, 200)
	for batch := range 2 {
		upserts := []table.Upsert{}
		for index := range 100 {
			id := uuid.NewString()
			ids[batch*100+index] = id
			upserts = append(upserts, table.Upsert{ID: id, Values: map[string]any{field: "Before"}})
		}
		f.mutate(t, table.Changes{Upserts: upserts})
	}
	changes := table.Changes{Deletes: append([]string{}, ids[100:]...)}
	for _, id := range ids[:100] {
		changes.Upserts = append(changes.Upserts, table.Upsert{ID: id, Values: map[string]any{field: "After"}})
	}
	result := f.mutate(t, changes)
	if result.Inverse == nil || len(result.Inverse.Restores) != 200 || len(result.Inverse.Upserts) != 0 {
		t.Fatal("mixed batch undo expanded beyond the command limits")
	}
	f.mutate(t, *result.Inverse)
	page := f.records(t, "?page_size=100")
	if page.Pagination.Total != 200 {
		t.Fatal("mixed batch undo did not restore deleted records")
	}
	for _, row := range page.Items {
		if row.Values[field] != "Before" {
			t.Fatal("mixed batch undo did not restore updated values")
		}
	}
	missing := f.input(table.Changes{Restores: []table.RecordRestore{{ID: ids[0], TableVersion: 9999}}})
	f.env.Call(t, "POST", f.path+"/changes", f.session.AccessToken, missing, 404)
	deleted := f.mutate(t, table.Changes{Deletes: ids})
	restored := f.mutate(t, *deleted.Inverse)
	if restored.Inverse == nil || len(restored.Inverse.Deletes) != 200 {
		t.Fatal("restoring absent records did not produce a valid reverse operation")
	}
	f.mutate(t, *restored.Inverse)
	if f.records(t, "").Pagination.Total != 0 {
		t.Fatal("reverse of a bulk restore did not remove the restored records")
	}
	if result := f.mutate(t, table.Changes{Deletes: []string{uuid.NewString()}}); result.Inverse != nil {
		t.Fatal("an empty deletion produced an unusable inverse command")
	}
}

func TestUndoRestoresLargeRecordsWithoutAccumulatingHiddenCells(t *testing.T) {
	definition := table.DefaultDefinition()
	textIDs := []string{definition.Fields[0].ID}
	for range 7 {
		id := uuid.NewString()
		textIDs = append(textIDs, id)
		definition.Fields = append(definition.Fields, table.Field{ID: id, Name: "Large text", Kind: "text"})
	}
	f := newTable(t, &definition)
	id := uuid.NewString()
	values := map[string]any{}
	for _, field := range textIDs {
		values[field] = strings.Repeat("x", 8000)
	}
	f.mutate(t, table.Changes{Upserts: []table.Upsert{{ID: id, Values: values}}})
	newField := uuid.NewString()
	definition.Fields = append(definition.Fields, table.Field{ID: newField, Name: "New text", Kind: "text"})
	changed := f.mutate(t, table.Changes{
		Definition: &definition,
		Upserts:    []table.Upsert{{ID: id, Values: map[string]any{textIDs[0]: "Short", newField: strings.Repeat("y", 8000)}}},
	})
	f.mutate(t, *changed.Inverse)
	row := f.find(t, f.records(t, ""), id)
	if row.Values[textIDs[0]] != values[textIDs[0]] {
		t.Fatal("undo could not restore the original full record within its byte budget")
	}
	var retained bool
	if err := f.env.DB.Raw("SELECT jsonb_exists(values, ?) FROM data_table_record_versions WHERE table_id=? AND record_id=? AND valid_to IS NULL", newField, f.state.TableID, id).Scan(&retained).Error; err != nil {
		t.Fatal(err)
	}
	if retained {
		t.Fatal("undo kept newly introduced cells as hidden baggage")
	}
}
