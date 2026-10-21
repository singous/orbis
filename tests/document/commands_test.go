//go:build integration

package document_test

import (
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/tests/testenv"
)

func command(t *testing.T, f fixture, expected int64, ops ...document.Operation) document.CommandResult {
	t.Helper()
	return testenv.Decode[document.CommandResult](t, f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: expected, Operations: ops}, 200))
}
func TestSparseCommandsPreviewPreserveChildrenAndReplayReceipt(t *testing.T) {
	f := newDocument(t)
	parent, child, other := uuid.NewString(), block("unloaded child"), block(strings.Repeat("z", 1<<20))
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Doc", []document.Block{{ID: parent, Type: "quote", Content: []document.TextRun{{Text: "before"}}, Children: []document.Block{child}}, other}), 200)
	input := document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 2, Operations: []document.Operation{{Type: "update_block", BlockID: parent, Block: &document.Payload{Type: "quote", Content: []document.TextRun{{Text: "after"}}}}}}
	preview := testenv.Decode[document.CommandPreview](t, f.env.Call(t, "POST", f.path+"/operations/preview", f.session.AccessToken, input, 200))
	if preview.ExpectedVersion != 2 || preview.ProjectedVersion != 3 || len(preview.ChangedBlockIDs) != 1 {
		t.Fatal("invalid preview")
	}
	var receipts int64
	if err := f.env.DB.Table("document_operations").Where("operation_id=?", input.OperationID).Count(&receipts).Error; err != nil {
		t.Fatal(err)
	}
	if receipts != 0 {
		t.Fatal("preview reserved the operation")
	}
	result := testenv.Decode[document.CommandResult](t, f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, input, 200))
	if result.ContentVersion != 3 || len(result.ChangedBlockIDs) != 1 || result.ChangedBlockIDs[0] != parent || len(result.DeletedBlockIDs) != 0 {
		t.Fatal("shallow change touched unrelated blocks")
	}
	content := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200))
	if content.Blocks[0].Children[0].ID != child.ID || content.Blocks[0].Children[0].Content[0].Text != "unloaded child" {
		t.Fatal("unloaded child was overwritten")
	}
	for _, id := range []string{child.ID, other.ID} {
		var count int64
		if err := f.env.DB.Table("document_block_versions").Where("document_id=? AND block_id=?", f.documentID, id).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatal("unrelated payload was rewritten")
		}
	}
	command(t, f, 3, document.Operation{Type: "replace_text", BlockID: child.ID, Match: "unloaded", Replacement: "retained"})
	replay := testenv.Decode[document.CommandResult](t, f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, input, 200))
	if replay.ContentVersion != 3 {
		t.Fatal("replay returned a newer intent")
	}
	receipt := testenv.Decode[document.CommandResult](t, f.env.Call(t, "GET", f.path+"/operations/"+input.OperationID, f.session.AccessToken, nil, 200))
	if receipt.ContentVersion != 3 {
		t.Fatal("receipt was not immutable")
	}
	input.Operations[0].Block.Content[0].Text = "another intent"
	f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, input, 409)
	f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 4, "operations": []any{map[string]any{"type": "update_block", "block_id": parent, "block": map[string]any{"type": "quote", "children": []any{}}}}}, 400)
}
func TestSparseCommandsInsertMoveDeleteAndFinalTreeValidation(t *testing.T) {
	f := newDocument(t)
	a, b, c := block("a"), block("b"), block("c")
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Doc", []document.Block{a, b, c}), 200)
	group, child := uuid.NewString(), block("child")
	position := 1
	result := command(t, f, 2, document.Operation{Type: "insert_blocks", Position: &position, Blocks: []document.Block{{ID: group, Type: "group", Children: []document.Block{child}}}}, document.Operation{Type: "move_block", BlockID: a.ID, ParentID: &group, AfterID: &child.ID}, document.Operation{Type: "update_block", BlockID: group, Block: &document.Payload{Type: "callout", Props: map[string]any{"title": "Container", "tone": "info"}}})
	if result.ContentVersion != 3 || len(result.ChangedBlockIDs) != 3 {
		t.Fatalf("batch did not remain sparse: %+v", result)
	}
	state := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200))
	if state.Blocks[0].ID != group || len(state.Blocks[0].Children) != 2 || state.Blocks[0].Children[1].ID != a.ID {
		t.Fatal("insert or move order is incorrect")
	}
	invalid := document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 3, Operations: []document.Operation{{Type: "move_block", BlockID: group, ParentID: &a.ID}}}
	f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, invalid, 422)
	invalid.OperationID = uuid.NewString()
	invalid.Operations = []document.Operation{{Type: "delete_block", BlockID: group}}
	f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, invalid, 409)
	deleted := command(t, f, 3, document.Operation{Type: "delete_block", BlockID: group, DeleteSubtree: true})
	if len(deleted.DeletedBlockIDs) != 3 {
		t.Fatal("subtree deletion did not include descendants")
	}
	remaining := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200))
	if len(remaining.Blocks) != 2 || remaining.Blocks[0].ID != b.ID || remaining.Blocks[1].ID != c.ID {
		t.Fatal("deletion changed unrelated content")
	}
}
func TestSparseCommandConcurrencyAndReceiptRollback(t *testing.T) {
	f := newDocument(t)
	first, second := block("first"), block("second")
	inputs := []document.CommandsInput{{OperationID: uuid.NewString(), ExpectedVersion: 1, Operations: []document.Operation{{Type: "insert_blocks", Blocks: []document.Block{first}}}}, {OperationID: uuid.NewString(), ExpectedVersion: 1, Operations: []document.Operation{{Type: "insert_blocks", Blocks: []document.Block{second}}}}}
	results := make([]testenv.Result, 2)
	errs := make([]error, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range inputs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results[i], errs[i] = f.env.Do("POST", f.path+"/operations", f.session.AccessToken, inputs[i])
		}()
	}
	close(start)
	wg.Wait()
	wins, conflicts := 0, 0
	for i, result := range results {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		switch result.Status {
		case 200:
			wins++
		case 409:
			conflicts++
		default:
			t.Fatalf("unexpected result %+v", result)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatal("concurrent commands did not have a single winner")
	}
	if err := f.env.DB.Exec(`CREATE FUNCTION reject_command_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$`).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.env.DB.Exec(`CREATE TRIGGER reject_command_receipt BEFORE INSERT ON document_operations FOR EACH ROW EXECUTE FUNCTION reject_command_receipt()`).Error; err != nil {
		t.Fatal(err)
	}
	failed := document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 2, Operations: []document.Operation{{Type: "update_metadata", Title: "Must roll back"}}}
	f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, failed, 500)
	state := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200))
	if state.Revision.Version != 2 || state.Revision.Title != "Initial" {
		t.Fatal("receipt failure did not roll back content metadata")
	}
}
func TestSparseCommandsBackfillOldCachesOnlyDuringWrites(t *testing.T) {
	f := newDocument(t)
	a, b := block("one"), block("two")
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Doc", []document.Block{a, b}), 200)
	if err := f.env.DB.Exec("UPDATE document_block_versions SET payload_bytes=NULL,payload_digest=NULL WHERE document_id=?", f.documentID).Error; err != nil {
		t.Fatal(err)
	}
	input := document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 2, Operations: []document.Operation{{Type: "replace_text", BlockID: a.ID, Match: "one", Replacement: "changed"}}}
	f.env.Call(t, "POST", f.path+"/operations/preview", f.session.AccessToken, input, 200)
	var count int64
	if err := f.env.DB.Table("document_block_versions").Where("document_id=? AND valid_to IS NULL AND payload_bytes IS NULL", f.documentID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatal("preview mutated immutable cache metadata")
	}
	f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, input, 200)
	if err := f.env.DB.Table("document_block_versions").Where("document_id=? AND valid_to IS NULL AND payload_bytes IS NULL", f.documentID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("old active payload caches were not backfilled atomically")
	}
}
