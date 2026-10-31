//go:build integration

package sheet_test

import (
	"github.com/google/uuid"
	"net/url"
	"orbis.local/orbis/internal/sheet"
	"orbis.local/orbis/tests/testenv"
	"sync"
	"testing"
)

func TestRelativeRecordPlacementPreservesOrderAndReceipts(t *testing.T) {
	f := setup(t)
	field := f.table.Definition.Fields[0].ID
	a, b := uuid.NewString(), uuid.NewString()
	f.change(t, sheet.Patch{ID: a, Values: map[string]any{field: "A"}})
	f.change(t, sheet.Patch{ID: b, Values: map[string]any{field: "B"}})
	x, y := uuid.NewString(), uuid.NewString()
	input := sheet.Changes{OperationID: uuid.NewString(), SchemaVersion: f.table.SchemaVersion, Records: []sheet.Patch{{ID: x, BeforeID: b}, {ID: y, BeforeID: b}}}
	first := testenv.Decode[sheet.ChangeResult](t, f.env.Call(t, "POST", f.path+"/changes", f.token, input, 200))
	retry := testenv.Decode[sheet.ChangeResult](t, f.env.Call(t, "POST", f.path+"/changes", f.token, input, 200))
	if len(retry.Records) != 2 || retry.Records[0].Position != first.Records[0].Position {
		t.Fatal("placement retry changed receipt")
	}
	assertOrder := func(ids ...string) {
		t.Helper()
		items := f.page(t, "").Items
		if len(items) != len(ids) {
			t.Fatalf("got %d records", len(items))
		}
		for i, id := range ids {
			if items[i].ID != id {
				t.Fatalf("unexpected order at %d: got %s want %s", i, items[i].ID, id)
			}
		}
	}
	assertOrder(a, x, y, b)
	f.change(t, sheet.Patch{ID: b, Version: 1, BeforeID: a})
	assertOrder(b, a, x, y)
	c := uuid.NewString()
	f.change(t, sheet.Patch{ID: c})
	assertOrder(b, a, x, y, c)
	input.OperationID = uuid.NewString()
	input.Records = []sheet.Patch{{ID: uuid.NewString(), AfterID: a}, {ID: uuid.NewString(), AfterID: a}}
	f.env.Call(t, "POST", f.path+"/changes", f.token, input, 200)
	assertOrder(b, a, input.Records[0].ID, input.Records[1].ID, x, y, c)
	// Re-ranking neighbors never invalidates their content versions.
	f.change(t, sheet.Patch{ID: a, Version: 1, Values: map[string]any{field: "Edited"}})
}

func TestRelativeRecordPlacementRejectsInvalidAnchorsAtomically(t *testing.T) {
	f := setup(t)
	a := uuid.NewString()
	f.change(t, sheet.Patch{ID: a})
	other := testenv.Decode[sheet.Sheet](t, f.env.Call(t, "POST", "/api/v1/workspaces/"+f.table.WorkspaceID+"/sheets", f.token, sheet.Create{ID: uuid.NewString(), CollectionID: f.table.CollectionID, Title: "Other"}, 201))
	foreign := uuid.NewString()
	f.env.Call(t, "POST", "/api/v1/workspaces/"+f.table.WorkspaceID+"/sheets/"+other.ID+"/changes", f.token, sheet.Changes{OperationID: uuid.NewString(), SchemaVersion: other.SchemaVersion, Records: []sheet.Patch{{ID: foreign}}}, 200)
	for _, anchor := range []string{uuid.NewString(), foreign} {
		f.env.Call(t, "POST", f.path+"/changes", f.token, sheet.Changes{OperationID: uuid.NewString(), SchemaVersion: f.table.SchemaVersion, Records: []sheet.Patch{{ID: uuid.NewString(), BeforeID: anchor}}}, 409)
	}
	if len(f.page(t, "").Items) != 1 {
		t.Fatal("invalid anchor partially inserted a record")
	}
	f.env.Call(t, "POST", f.path+"/changes", f.token, sheet.Changes{OperationID: uuid.NewString(), SchemaVersion: f.table.SchemaVersion, Records: []sheet.Patch{{ID: a, Version: 1, BeforeID: a}}}, 422)
	// Version conflicts roll back both content and position changes.
	f.env.Call(t, "POST", f.path+"/changes", f.token, sheet.Changes{OperationID: uuid.NewString(), SchemaVersion: f.table.SchemaVersion, Records: []sheet.Patch{{ID: uuid.NewString(), BeforeID: a}, {ID: uuid.NewString(), Version: 3}}}, 409)
	if len(f.page(t, "").Items) != 1 {
		t.Fatal("conflicting batch partially inserted a record")
	}
}

func TestRelativeRecordPlacementSerializesConcurrentWriters(t *testing.T) {
	f := setup(t)
	anchor := uuid.NewString()
	f.change(t, sheet.Patch{ID: anchor})
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); f.change(t, sheet.Patch{ID: uuid.NewString(), BeforeID: anchor}) }()
	}
	wg.Wait()
	items := f.page(t, "").Items
	if len(items) != 9 || items[8].ID != anchor {
		t.Fatal("concurrent placement lost a row or its anchor")
	}
	positions := map[int64]bool{}
	for _, row := range items {
		if positions[row.Position] {
			t.Fatal("concurrent placement produced tied positions")
		}
		positions[row.Position] = true
	}
}

func TestRelativeRecordPlacementInvalidatesOldCursorsOnlyAfterReordering(t *testing.T) {
	f := setup(t)
	// Ensure pre-reorder positions are larger than the sheet's own record count.
	if err := f.env.DB.Exec("SELECT setval(pg_get_serial_sequence('sheet_records','position'),1000)").Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		f.change(t, sheet.Patch{ID: uuid.NewString()})
	}
	rows := f.page(t, "").Items
	first := f.page(t, "?limit=1")
	if first.NextCursor == "" {
		t.Fatal("expected a cursor")
	}
	f.change(t, sheet.Patch{ID: rows[0].ID, Version: rows[0].Version, Values: map[string]any{f.table.Definition.Fields[0].ID: "Edited"}})
	// Ordinary edits retain the existing pagination contract.
	if len(f.page(t, "?limit=1&cursor="+url.QueryEscape(first.NextCursor)).Items) != 1 {
		t.Fatal("ordinary edit invalidated pagination")
	}
	f.change(t, sheet.Patch{ID: rows[2].ID, Version: rows[2].Version, BeforeID: rows[0].ID})
	f.env.Call(t, "GET", f.path+"/records?limit=1&cursor="+url.QueryEscape(first.NextCursor), f.token, nil, 422)
	fresh := f.page(t, "?limit=1")
	if fresh.Items[0].ID != rows[2].ID || len(f.page(t, "?limit=1&cursor="+url.QueryEscape(fresh.NextCursor)).Items) != 1 {
		t.Fatal("fresh cursor did not resume the reordered records")
	}
}
