//go:build integration

package table_test

import (
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/table"
	"orbis.local/orbis/tests/testenv"
)

func atomicCopyInput(source fixture, expected, sourceVersion, tableVersion int64, blockID string) document.CommandsInput {
	return document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: expected,
		Operations:  []document.Operation{{Type: "insert_blocks", Blocks: []document.Block{{ID: blockID, Type: "data_table", Props: map[string]any{"table_id": source.state.TableID, "table_version": tableVersion}}}}},
		TableCopies: []document.TableCopy{{BlockID: blockID, Source: document.TableCopySource{WorkspaceID: source.wid, DocumentID: source.did, TableID: source.state.TableID, DocumentVersion: sourceVersion}}}}
}
func copyTarget(t *testing.T, f fixture) (string, string) {
	t.Helper()
	doc := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", "/api/v1/workspaces/"+f.wid+"/collections/"+f.cid+"/documents", f.session.AccessToken, map[string]any{"title": "Atomic target"}, 201))
	return doc.ID, "/api/v1/workspaces/" + f.wid + "/documents/" + doc.ID
}
func tableCount(t *testing.T, f fixture) int64 {
	t.Helper()
	var count int64
	if err := f.env.DB.Table("data_tables").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	return count
}
func resolvedTable(t *testing.T, result document.CommandResult, blockID string) string {
	t.Helper()
	for _, block := range result.ResolvedBlocks {
		if block.ID == blockID {
			ref, ok := document.TableReference(block.ID, block.Payload)
			if !ok || ref.Version != 1 {
				t.Fatal("invalid resolved table reference")
			}
			return ref.TableID
		}
	}
	t.Fatal("copy omitted its authoritative block reference")
	return ""
}

func TestAtomicDocumentTableCopyPinsSnapshotAndReplaysResolvedReferences(t *testing.T) {
	definition := table.DefaultDefinition()
	number, checked, date := uuid.NewString(), uuid.NewString(), uuid.NewString()
	numberIndex := len(definition.Fields)
	definition.Fields = append(definition.Fields, table.Field{ID: number, Name: "Number", Kind: "number"}, table.Field{ID: checked, Name: "Checked", Kind: "checkbox"}, table.Field{ID: date, Name: "Date", Kind: "datetime"})
	f := newTable(t, &definition)
	text, status, option := definition.Fields[0].ID, definition.Fields[1].ID, definition.Fields[1].Options[0].ID
	first, second := uuid.NewString(), uuid.NewString()
	f.mutate(t, table.Changes{Upserts: []table.Upsert{{ID: first, Values: map[string]any{text: option, status: option, number: 0, checked: false, date: 0}}, {ID: second, Values: map[string]any{text: "visible", number: nil}}}})
	definition.Views[0].Filters = []table.Filter{{FieldID: text, Operator: "eq", Value: "visible"}}
	f.mutate(t, table.Changes{Definition: &definition})
	sourceVersion, sourceTableVersion := f.state.ContentVersion, f.state.TableVersion
	blockID := uuid.NewString()
	input := atomicCopyInput(f, sourceVersion, sourceVersion, sourceTableVersion, blockID)
	before := tableCount(t, f)
	f.env.Call(t, "POST", f.docPath+"/operations/preview", f.session.AccessToken, input, 200)
	if tableCount(t, f) != before {
		t.Fatal("preview persisted a table")
	}
	result := testenv.Decode[document.CommandResult](t, f.env.Call(t, "POST", f.docPath+"/operations", f.session.AccessToken, input, 200))
	copiedID := resolvedTable(t, result, blockID)
	if copiedID == f.state.TableID || result.ContentVersion != sourceVersion+1 || len(result.ChangedBlockIDs) != 1 {
		t.Fatal("copy reused identity or rewrote unrelated content")
	}
	target := f
	target.blockID = blockID
	target.path = f.docPath + "/tables/" + copiedID
	meta := target.meta(t, "")
	rows := target.records(t, "?view_id="+meta.Definition.Views[1].ID)
	if rows.Pagination.Total != 2 || meta.Definition.Fields[0].ID == text || meta.Definition.Views[0].ID == definition.Views[0].ID {
		t.Fatal("copy lost filtered-out data or reused structural identities")
	}
	found := false
	for _, row := range rows.Items {
		if row.ID == first || row.ID == second {
			t.Fatal("copy reused a record ID")
		}
		if row.Values[meta.Definition.Fields[0].ID] == option {
			found = true
			if row.Values[meta.Definition.Fields[1].ID] != meta.Definition.Fields[1].Options[0].ID || row.Values[meta.Definition.Fields[numberIndex].ID] != float64(0) || row.Values[meta.Definition.Fields[numberIndex+1].ID] != false || row.Values[meta.Definition.Fields[numberIndex+2].ID] != float64(0) {
				t.Fatal("copy changed semantic values")
			}
		}
	}
	if !found {
		t.Fatal("UUID-shaped text was rewritten")
	}
	f.state.ContentVersion = result.ContentVersion
	f.mutate(t, table.Changes{Upserts: []table.Upsert{{ID: first, Values: map[string]any{text: "later"}}}})
	replay := testenv.Decode[document.CommandResult](t, f.env.Call(t, "POST", f.docPath+"/operations", f.session.AccessToken, input, 200))
	if replay.ContentVersion != result.ContentVersion || resolvedTable(t, replay, blockID) != copiedID || tableCount(t, f) != before+1 {
		t.Fatal("replay allocated another copy")
	}
	historicalID := uuid.NewString()
	historical := atomicCopyInput(f, f.state.ContentVersion, sourceVersion, sourceTableVersion, historicalID)
	old := testenv.Decode[document.CommandResult](t, f.env.Call(t, "POST", f.docPath+"/operations", f.session.AccessToken, historical, 200))
	target.path = f.docPath + "/tables/" + resolvedTable(t, old, historicalID)
	target.blockID = historicalID
	oldMeta := target.meta(t, "")
	oldRows := target.records(t, "?view_id="+oldMeta.Definition.Views[1].ID)
	for _, row := range oldRows.Items {
		if row.Values[oldMeta.Definition.Fields[0].ID] == "later" {
			t.Fatal("fixed source snapshot read newer records")
		}
	}
}

func TestAtomicDocumentTableCopyRollsBackAndReplaysAfterSourceArchive(t *testing.T) {
	f := newTable(t, nil)
	did, path := copyTarget(t, f)
	first, second := uuid.NewString(), uuid.NewString()
	input := atomicCopyInput(f, 1, f.state.ContentVersion, f.state.TableVersion, first)
	badTable := uuid.NewString()
	input.Operations[0].Blocks = append(input.Operations[0].Blocks, document.Block{ID: second, Type: "data_table", Props: map[string]any{"table_id": badTable, "table_version": 1}})
	input.TableCopies = append(input.TableCopies, document.TableCopy{BlockID: second, Source: document.TableCopySource{WorkspaceID: f.wid, DocumentID: f.did, TableID: badTable, DocumentVersion: f.state.ContentVersion}})
	before := tableCount(t, f)
	f.env.Call(t, "POST", path+"/operations", f.session.AccessToken, input, 404)
	if tableCount(t, f) != before {
		t.Fatal("failed copy retained a partially created table")
	}
	meta := testenv.Decode[struct {
		ContentVersion int64 `json:"content_version"`
	}](t, f.env.Call(t, "GET", path, f.session.AccessToken, nil, 200))
	if meta.ContentVersion != 1 {
		t.Fatal("failed copy advanced document version")
	}
	var receipts int64
	if err := f.env.DB.Table("document_operations").Where("document_id=?", did).Count(&receipts).Error; err != nil || receipts != 0 {
		t.Fatal("failed copy retained an operation receipt", err)
	}
	input.Operations[0].Blocks = input.Operations[0].Blocks[:1]
	input.TableCopies = input.TableCopies[:1]
	result := testenv.Decode[document.CommandResult](t, f.env.Call(t, "POST", path+"/operations", f.session.AccessToken, input, 200))
	id := resolvedTable(t, result, first)
	collection := testenv.Decode[struct {
		DirectoryVersion int64 `json:"directory_version"`
	}](t, f.env.Call(t, "GET", "/api/v1/workspaces/"+f.wid+"/collections/"+f.cid, f.session.AccessToken, nil, 200))
	f.env.Call(t, "PUT", f.docPath+"/archive", f.session.AccessToken, map[string]any{"expected_directory_version": collection.DirectoryVersion, "archived": true}, 200)
	replay := testenv.Decode[document.CommandResult](t, f.env.Call(t, "POST", path+"/operations", f.session.AccessToken, input, 200))
	if resolvedTable(t, replay, first) != id || tableCount(t, f) != before+1 {
		t.Fatal("replay unnecessarily re-read archived source")
	}
	input.OperationID = uuid.NewString()
	input.ExpectedVersion = 2
	input.Operations[0].Blocks[0].ID = uuid.NewString()
	input.TableCopies[0].BlockID = input.Operations[0].Blocks[0].ID
	f.env.Call(t, "POST", path+"/operations", f.session.AccessToken, input, 404)
}

func TestAtomicDocumentTableCopyEnforcesAgentSourceScope(t *testing.T) {
	f := newTable(t, nil)
	did, path := copyTarget(t, f)
	credential := testenv.Decode[struct{ Token string }](t, f.env.Call(t, "POST", "/api/v1/workspaces/"+f.wid+"/integration-tokens", f.session.AccessToken, integration.TokenInput{Name: "Scoped copy", DocumentID: &did, Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}}, 201))
	agent := "/api/v1/agent/workspaces/" + f.wid + "/documents/" + did
	input := atomicCopyInput(f, 1, f.state.ContentVersion, f.state.TableVersion, uuid.NewString())
	before := tableCount(t, f)
	f.env.Call(t, "POST", agent+"/operations/preview", credential.Token, input, 404)
	f.env.Call(t, "POST", agent+"/operations", credential.Token, input, 404)
	if tableCount(t, f) != before {
		t.Fatal("scoped token copied an unauthorized source")
	}
	broad := testenv.Decode[struct{ Token string }](t, f.env.Call(t, "POST", "/api/v1/workspaces/"+f.wid+"/integration-tokens", f.session.AccessToken, integration.TokenInput{Name: "Workspace copy", Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}}, 201))
	result := testenv.Decode[document.CommandResult](t, f.env.Call(t, "POST", agent+"/operations", broad.Token, input, 200))
	resolvedTable(t, result, input.TableCopies[0].BlockID)
	meta := testenv.Decode[struct {
		ContentVersion int64 `json:"content_version"`
	}](t, f.env.Call(t, "GET", path, f.session.AccessToken, nil, 200))
	if meta.ContentVersion != 2 {
		t.Fatal("authorized agent copy did not commit")
	}
}

func TestOppositeAtomicDocumentTableCopiesDoNotLockSources(t *testing.T) {
	first := newTable(t, nil)
	second := createTableFixture(t, first.env, first.session, first.wid, nil)
	fixtures := []fixture{first, second}
	errors := make(chan error, 2)
	var workers sync.WaitGroup
	for index, target := range fixtures {
		source := fixtures[1-index]
		input := atomicCopyInput(source, target.state.ContentVersion, source.state.ContentVersion, source.state.TableVersion, uuid.NewString())
		workers.Go(func() {
			result, err := target.env.Do("POST", target.docPath+"/operations", target.session.AccessToken, input)
			if err == nil && result.Status != 200 {
				err = fmt.Errorf("atomic copy status=%d code=%s", result.Status, result.Code)
			}
			errors <- err
		})
	}
	workers.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestAtomicDocumentTableCopiesShareOneTransferBudget(t *testing.T) {
	f := newTable(t, nil)
	field := f.meta(t, "").Definition.Fields[0].ID
	text := strings.Repeat("x", 8192)
	for batch := 0; batch < 6; batch++ {
		rows := make([]table.Upsert, 200)
		for index := range rows {
			rows[index] = table.Upsert{ID: uuid.NewString(), Values: map[string]any{field: text}}
		}
		f.mutate(t, table.Changes{Upserts: rows})
	}
	did, path := copyTarget(t, f)
	first, second := uuid.NewString(), uuid.NewString()
	input := atomicCopyInput(f, 1, f.state.ContentVersion, f.state.TableVersion, first)
	input.Operations[0].Blocks = append(input.Operations[0].Blocks, document.Block{ID: second, Type: "data_table", Props: map[string]any{"table_id": f.state.TableID, "table_version": f.state.TableVersion}})
	input.TableCopies = append(input.TableCopies, document.TableCopy{BlockID: second, Source: input.TableCopies[0].Source})
	before := tableCount(t, f)
	for _, suffix := range []string{"/operations/preview", "/operations"} {
		result := f.env.Call(t, "POST", path+suffix, f.session.AccessToken, input, 422)
		if result.Code != "TABLE_COPY_TOO_LARGE" {
			t.Fatal("combined copy budget was not enforced", result.Code)
		}
	}
	if tableCount(t, f) != before {
		t.Fatal("over-budget action retained a partial table")
	}
	meta := testenv.Decode[struct {
		ContentVersion int64 `json:"content_version"`
	}](t, f.env.Call(t, "GET", path, f.session.AccessToken, nil, 200))
	if meta.ContentVersion != 1 {
		t.Fatal("over-budget action advanced document", did)
	}
}

func TestAtomicDocumentTableCopyAuthorizesCrossWorkspaceSourcesAndBoundsAgentTokens(t *testing.T) {
	f := newTable(t, nil)
	other := f.env.AddUser(t, "copy-source-owner@example.test")
	space := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", "/api/v1/workspaces", other.AccessToken, map[string]any{"name": "Other source"}, 201))
	source := createTableFixture(t, f.env, other, space.ID, nil)
	_, path := copyTarget(t, f)
	input := atomicCopyInput(source, 1, source.state.ContentVersion, source.state.TableVersion, uuid.NewString())
	before := tableCount(t, f)
	f.env.Call(t, "POST", path+"/operations", f.session.AccessToken, input, 404)
	if tableCount(t, f) != before {
		t.Fatal("unauthorized source created a table")
	}
	now := f.env.Clock.Now().UnixMilli()
	if err := f.env.DB.Exec("INSERT INTO workspace_members(workspace_id,user_id,role,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?)", source.wid, f.session.User.ID, "viewer", now, now).Error; err != nil {
		t.Fatal(err)
	}
	result := testenv.Decode[document.CommandResult](t, f.env.Call(t, "POST", path+"/operations", f.session.AccessToken, input, 200))
	resolvedTable(t, result, input.TableCopies[0].BlockID)
	credential := testenv.Decode[struct{ Token string }](t, f.env.Call(t, "POST", "/api/v1/workspaces/"+f.wid+"/integration-tokens", f.session.AccessToken, integration.TokenInput{Name: "Workspace-bound copy", Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}}, 201))
	input.ExpectedVersion = result.ContentVersion
	input.OperationID = uuid.NewString()
	input.Operations[0].Blocks[0].ID = uuid.NewString()
	input.TableCopies[0].BlockID = input.Operations[0].Blocks[0].ID
	agent := "/api/v1/agent/workspaces/" + f.wid + "/documents/" + result.DocumentID
	f.env.Call(t, "POST", agent+"/operations/preview", credential.Token, input, 403)
	f.env.Call(t, "POST", agent+"/operations", credential.Token, input, 403)
	if tableCount(t, f) != before+1 {
		t.Fatal("workspace-bound token copied outside its workspace")
	}
}
