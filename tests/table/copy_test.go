//go:build integration

package table_test

import (
	"sync"
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/table"
	"orbis.local/orbis/tests/testenv"
)

func placeholder(t *testing.T, f fixture) (string, string, string) {
	t.Helper()
	doc := testenv.Decode[struct{ ID string }](t, f.env.Call(
		t,
		"POST",
		"/api/v1/workspaces/"+f.wid+"/collections/"+f.cid+"/documents",
		f.session.AccessToken,
		map[string]any{"title": "Copy target"},
		201,
	))
	id := uuid.NewString()
	path := "/api/v1/workspaces/" + f.wid + "/documents/" + doc.ID
	f.env.Call(
		t,
		"PUT",
		path+"/content",
		f.session.AccessToken,
		map[string]any{
			"operation_id":     uuid.NewString(),
			"expected_version": 1,
			"title":            "Copy target",
			"blocks":           []document.Block{{ID: id, Type: "data_table"}},
		},
		200,
	)
	return doc.ID, id, path
}
func TestTableCopyKeepsAllRecordsAndIndependentIdentities(t *testing.T) {
	f := newTable(t, nil)
	def := f.meta(t, "").Definition
	textID, statusID := def.Fields[0].ID, def.Fields[1].ID
	optionID := def.Fields[1].Options[0].ID
	first, second := uuid.NewString(), uuid.NewString()
	f.mutate(
		t,
		table.Changes{Upserts: []table.Upsert{{ID: first, Values: map[string]any{textID: optionID, statusID: optionID}}, {ID: second, Values: map[string]any{textID: "visible"}}}},
	)
	def.Views[0].Filters = []table.Filter{{FieldID: textID, Operator: "eq", Value: "visible"}}
	f.mutate(t, table.Changes{Definition: &def})
	did, bid, path := placeholder(t, f)
	input := table.CreateInput{
		OperationID:             uuid.NewString(),
		ExpectedDocumentVersion: 2,
		BlockID:                 bid,
		Source:                  &table.Source{WorkspaceID: f.wid, DocumentID: f.did, TableID: f.state.TableID},
	}
	copied := testenv.Decode[table.Result](t, f.env.Call(
		t,
		"POST",
		path+"/tables",
		f.session.AccessToken,
		input,
		201,
	))
	target := fixture{
		env:     f.env,
		session: f.session,
		wid:     f.wid,
		cid:     f.cid,
		did:     did,
		blockID: bid,
		docPath: path,
		path:    path + "/tables/" + copied.TableID,
		state:   copied,
	}
	meta := target.meta(t, "")
	rows := target.records(t, "?view_id="+meta.Definition.Views[1].ID)
	if rows.Pagination.Total != 2 || meta.Definition.Fields[0].ID == textID || meta.Definition.Fields[1].Options[0].ID == optionID {
		t.Fatal("copy lost filtered-out records or reused structural identities")
	}
	var copiedFirst string
	for _, row := range rows.Items {
		if row.ID == first || row.ID == second {
			t.Fatal("copy reused record IDs")
		}
		if row.Values[meta.Definition.Fields[0].ID] == optionID {
			copiedFirst = row.ID
			if row.Values[meta.Definition.Fields[1].ID] != meta.Definition.Fields[1].Options[0].ID {
				t.Fatal("select option was not remapped")
			}
		}
	}
	if copiedFirst == "" {
		t.Fatal("UUID-shaped authored text was rewritten")
	}
	target.mutate(t, table.Changes{Upserts: []table.Upsert{{ID: copiedFirst, Values: map[string]any{meta.Definition.Fields[0].ID: "Independent"}}}})
	sourceRows := f.records(t, "?view_id="+def.Views[1].ID)
	if f.find(t, sourceRows, first).Values[textID] != optionID {
		t.Fatal("copy edit changed source data")
	}
	version := testenv.Decode[struct {
		Version int64 `json:"directory_version"`
	}](t, f.env.Call(
		t,
		"GET",
		"/api/v1/workspaces/"+f.wid+"/collections/"+f.cid,
		f.session.AccessToken,
		nil,
		200,
	)).Version
	f.env.Call(
		t,
		"PUT",
		f.docPath+"/archive",
		f.session.AccessToken,
		map[string]any{"expected_directory_version": version, "archived": true},
		200,
	)
	replay := testenv.Decode[table.Result](t, f.env.Call(
		t,
		"POST",
		path+"/tables",
		f.session.AccessToken,
		input,
		201,
	))
	if replay.TableID != copied.TableID || replay.TableVersion != 1 {
		t.Fatal("copy replay unnecessarily depended on current source visibility")
	}
	_, nextID, nextPath := placeholder(t, target)
	input.OperationID = uuid.NewString()
	input.BlockID = nextID
	f.env.Call(
		t,
		"POST",
		nextPath+"/tables",
		f.session.AccessToken,
		input,
		404,
	)
}

func TestTableAccessAndReferencesStayBoundToDocument(t *testing.T) {
	f := newTable(t, nil)
	viewer := f.env.AddUser(t, "viewer@example.test")
	now := f.env.Clock.Now().UnixMilli()
	if err := f.env.DB.Exec(
		"INSERT INTO workspace_members (workspace_id,user_id,role,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?)",
		f.wid,
		viewer.User.ID,
		"viewer",
		now,
		now,
	).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(
		t,
		"GET",
		f.path,
		viewer.AccessToken,
		nil,
		200,
	)
	f.env.Call(
		t,
		"POST",
		f.path+"/changes",
		viewer.AccessToken,
		f.input(table.Changes{Deletes: []string{uuid.NewString()}}),
		403,
	)
	outsider := f.env.AddUser(t, "outsider@example.test")
	f.env.Call(
		t,
		"GET",
		f.path,
		outsider.AccessToken,
		nil,
		404,
	)
	otherWorkspace := testenv.Decode[struct{ ID string }](t, f.env.Call(
		t,
		"POST",
		"/api/v1/workspaces",
		outsider.AccessToken,
		map[string]any{"name": "Other workspace"},
		201,
	))
	other := createTableFixture(t, f.env, outsider, otherWorkspace.ID, nil)
	_, otherBlock, otherPath := placeholder(t, other)
	f.env.Call(
		t,
		"POST",
		otherPath+"/tables",
		outsider.AccessToken,
		table.CreateInput{
			OperationID: uuid.NewString(), ExpectedDocumentVersion: 2, BlockID: otherBlock,
			Source: &table.Source{WorkspaceID: f.wid, DocumentID: f.did, TableID: f.state.TableID},
		},
		404,
	)
	_, _, path := placeholder(t, f)
	f.env.Call(
		t,
		"GET",
		path+"/tables/"+f.state.TableID,
		f.session.AccessToken,
		nil,
		404,
	)
	for _, targetPath := range []string{path, f.docPath} {
		expected := int64(2)
		if targetPath == f.docPath {
			expected = f.state.ContentVersion
		}
		response := f.env.Call(
			t,
			"PUT",
			targetPath+"/content",
			f.session.AccessToken,
			map[string]any{
				"operation_id":     uuid.NewString(),
				"expected_version": expected,
				"title":            "Forged",
				"blocks":           []document.Block{{ID: uuid.NewString(), Type: "data_table", Props: map[string]any{"table_id": f.state.TableID, "table_version": 1}}},
			},
			404,
		)
		if response.Code != "TABLE_REFERENCE_NOT_FOUND" {
			t.Fatal("table ownership was not enforced on ordinary document writes")
		}
	}
	version := testenv.Decode[struct {
		Version int64 `json:"directory_version"`
	}](t, f.env.Call(
		t,
		"GET",
		"/api/v1/workspaces/"+f.wid+"/collections/"+f.cid,
		f.session.AccessToken,
		nil,
		200,
	)).Version
	f.env.Call(
		t,
		"PUT",
		"/api/v1/workspaces/"+f.wid+"/collections/"+f.cid+"/archive",
		f.session.AccessToken,
		map[string]any{"expected_directory_version": version, "archived": true},
		200,
	)
	f.env.Call(
		t,
		"GET",
		f.path+"/records?document_version=3",
		f.session.AccessToken,
		nil,
		404,
	)
	f.env.Call(
		t,
		"POST",
		f.path+"/changes",
		f.session.AccessToken,
		f.input(table.Changes{Deletes: []string{uuid.NewString()}}),
		404,
	)
}

func TestOppositeTableCopiesDoNotLockTheirSources(t *testing.T) {
	first := newTable(t, nil)
	second := createTableFixture(t, first.env, first.session, first.wid, nil)
	targets := []fixture{first, second}
	blockIDs := []string{uuid.NewString(), uuid.NewString()}
	for index, target := range targets {
		target.env.Call(
			t,
			"PUT",
			target.docPath+"/content",
			target.session.AccessToken,
			map[string]any{
				"operation_id": uuid.NewString(), "expected_version": target.state.ContentVersion, "title": "Copy targets",
				"blocks": []document.Block{
					{ID: target.blockID, Type: "data_table", Props: map[string]any{"table_id": target.state.TableID, "table_version": target.state.TableVersion}},
					{ID: blockIDs[index], Type: "data_table"},
				},
			},
			200,
		)
	}
	type outcome struct {
		result testenv.Result
		err    error
	}
	results := make(chan outcome, 2)
	var workers sync.WaitGroup
	for index, target := range targets {
		source := targets[1-index]
		input := table.CreateInput{
			OperationID:             uuid.NewString(),
			ExpectedDocumentVersion: 4,
			BlockID:                 blockIDs[index],
			Source:                  &table.Source{WorkspaceID: source.wid, DocumentID: source.did, TableID: source.state.TableID},
		}
		workers.Go(func() {
			result, err := target.env.Do("POST", target.docPath+"/tables", target.session.AccessToken, input)
			results <- outcome{result: result, err: err}
		})
	}
	workers.Wait()
	close(results)
	for result := range results {
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.result.Status != 201 {
			t.Fatalf("opposite copy failed: status=%d code=%s", result.result.Status, result.result.Code)
		}
	}
}
