//go:build integration

package board_test

import (
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/tests/testenv"
)

type fixture struct {
	env         *testenv.Environment
	token, path string
	board       board.Board
}

func setup(t *testing.T) fixture {
	t.Helper()
	env := testenv.New(t)
	session, wid := env.Owner(t)
	base := "/api/v1/workspaces/" + wid
	collection := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/collections", session.AccessToken, map[string]any{"title": "Board tests"}, 201))
	input := board.Create{ID: uuid.NewString(), OperationID: uuid.NewString(), CollectionID: collection.ID, Title: "Architecture", PageID: uuid.NewString(), Elements: []board.Element{}}
	result := testenv.Decode[board.Board](t, env.Call(t, "POST", base+"/boards", session.AccessToken, input, 201))
	replay := testenv.Decode[board.Board](t, env.Call(t, "POST", base+"/boards", session.AccessToken, input, 201))
	if replay.DocumentID != result.DocumentID {
		t.Fatal("create retry duplicated directory resource")
	}
	return fixture{env, session.AccessToken, base + "/boards/" + result.ID, result}
}
func node(page string) board.Element {
	return board.Element{ID: uuid.NewString(), PageID: page, ShapeType: "flow.process", ShapeVersion: 1, Geometry: board.Geometry{Width: 180, Height: 80}, Style: board.Style{Fill: "#ffffff", Stroke: "#64748b", StrokeWidth: 1.5, FontSize: 14, TextColor: "#1e293b", Opacity: 1, Align: "center"}, Text: "Service", Structure: board.Structure{Route: "orthogonal", StartMarker: "none", EndMarker: "arrow", Members: []board.Member{}, Points: []board.Point{}}}
}
func (f fixture) change(t *testing.T, commands ...board.Command) board.Change {
	t.Helper()
	return testenv.Decode[board.Change](t, f.env.Call(t, "POST", f.path+"/commands", f.token, board.Mutation{OperationID: uuid.NewString(), SchemaVersion: 1, Commands: commands}, 200))
}
func TestBoardReceiptsConflictsAndSnapshots(t *testing.T) {
	f := setup(t)
	a, b := node(f.board.Pages[0].ID), node(f.board.Pages[0].ID)
	created := f.change(t, board.Command{Type: "elements.create", Elements: []board.Element{a, b}})
	current := map[string]board.Element{}
	for _, e := range created.Elements {
		current[e.ID] = e
	}
	a = current[a.ID]
	b = current[b.ID]
	geometry := a.Geometry
	geometry.X = 120
	input := board.Mutation{OperationID: uuid.NewString(), SchemaVersion: 1, Commands: []board.Command{{Type: "elements.update", Patches: []board.Patch{{ID: a.ID, Expected: a.Versions, Geometry: &geometry}}}}}
	first := testenv.Decode[board.Change](t, f.env.Call(t, "POST", f.path+"/commands", f.token, input, 200))
	replay := testenv.Decode[board.Change](t, f.env.Call(t, "POST", f.path+"/commands", f.token, input, 200))
	if first.Revision != replay.Revision {
		t.Fatal("retry advanced revision")
	}
	text := "Concurrent label"
	f.change(t, board.Command{Type: "elements.update", Patches: []board.Patch{{ID: a.ID, Expected: a.Versions, Text: &text}}})
	input.OperationID = uuid.NewString()
	input.Commands[0].Patches = append(input.Commands[0].Patches, board.Patch{ID: b.ID, Expected: b.Versions, Text: &text})
	f.env.Call(t, "POST", f.path+"/commands", f.token, input, 409)
	snapshot := testenv.Decode[board.Snapshot](t, f.env.Call(t, "GET", f.path+"/snapshot?revision=2", f.token, nil, 200))
	if len(snapshot.Elements) != 2 {
		t.Fatal("historical elements missing")
	}
	for _, e := range snapshot.Elements {
		if e.Geometry.X != 0 || e.Text != "Service" {
			t.Fatal("old snapshot changed")
		}
	}
	latest := testenv.Decode[board.Snapshot](t, f.env.Call(t, "GET", f.path+"/snapshot", f.token, nil, 200))
	for _, e := range latest.Elements {
		if e.ID == b.ID && e.Text != "Service" {
			t.Fatal("conflicting batch partially committed")
		}
	}
}
func TestBoardDeleteRestoresAndAncestorVisibility(t *testing.T) {
	f := setup(t)
	a, b := node(f.board.Pages[0].ID), node(f.board.Pages[0].ID)
	edge := node(a.PageID)
	edge.ShapeType = "connector"
	edge.Structure.Start = &board.Endpoint{ElementID: &a.ID, Port: "right"}
	edge.Structure.End = &board.Endpoint{ElementID: &b.ID, Port: "left"}
	f.change(t, board.Command{Type: "elements.create", Elements: []board.Element{a, b, edge}})
	deleted := f.change(t, board.Command{Type: "elements.delete", Targets: []board.Target{{ID: a.ID, Version: 1}}})
	if len(deleted.Deleted) != 2 {
		t.Fatal("node deletion did not atomically remove incident edge")
	}
	targets := []board.Target{{ID: a.ID, Version: 1}, {ID: edge.ID, Version: 1}}
	f.change(t, board.Command{Type: "elements.restore", Targets: targets})
	latest := testenv.Decode[board.Snapshot](t, f.env.Call(t, "GET", f.path+"/snapshot", f.token, nil, 200))
	if len(latest.Elements) != 3 {
		t.Fatal("restore lost connected elements")
	}
	if err := f.env.DB.Exec("UPDATE documents SET is_archived=TRUE WHERE id=?", f.board.DocumentID).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "GET", f.path, f.token, nil, 404)
	f.env.Call(t, "GET", f.path+"/snapshot?revision=2", f.token, nil, 404)
	f.env.Call(t, "GET", f.path+"/changes?after=0", f.token, nil, 404)
}

func TestPageUndoPreservesHistoricalIdentity(t *testing.T) {
	f := setup(t)
	page := board.Page{ID: uuid.NewString(), Name: "Second", Background: "#ffffff", Position: 1}
	created := f.change(t, board.Command{Type: "pages.create", Page: &page})
	page = created.Pages[0]
	f.change(t, board.Command{Type: "pages.delete", Page: &page})
	fresh := page
	fresh.Version = 0
	f.env.Call(t, "POST", f.path+"/commands", f.token, board.Mutation{OperationID: uuid.NewString(), SchemaVersion: 1, Commands: []board.Command{{Type: "pages.create", Page: &fresh}}}, 422)
	restored := f.change(t, board.Command{Type: "pages.restore", Page: &page})
	if len(restored.Pages) != 1 || restored.Pages[0].ID != page.ID || restored.Pages[0].Version != page.Version+1 {
		t.Fatal("page identity or monotonic version lost")
	}
	historical := testenv.Decode[board.Snapshot](t, f.env.Call(t, "GET", f.path+"/snapshot?revision=2", f.token, nil, 200))
	if len(historical.Board.Pages) != 2 {
		t.Fatal("restore changed historical pages")
	}
}

func TestElementPaginationUsesByteBudgetAndFixedCursor(t *testing.T) {
	f := setup(t)
	for range 8 {
		batch := []board.Element{}
		for range 5 {
			e := node(f.board.Pages[0].ID)
			e.ShapeType = "basic.line"
			e.Structure.Points = make([]board.Point, 10000)
			for i := range e.Structure.Points {
				e.Structure.Points[i] = board.Point{X: 1, Y: 1}
			}
			batch = append(batch, e)
		}
		f.change(t, board.Command{Type: "elements.create", Elements: batch})
	}
	path := f.path + "/pages/" + f.board.Pages[0].ID + "/elements?revision=9"
	first := testenv.Decode[board.ElementPage](t, f.env.Call(t, "GET", path, f.token, nil, 200))
	if len(first.Items) >= 40 || len(first.Items) == 0 || !first.HasMore || first.NextCursor == nil {
		t.Fatal("element page did not honor byte budget")
	}
	seen := map[string]bool{}
	for _, e := range first.Items {
		seen[e.ID] = true
	}
	cursor := first.NextCursor
	for cursor != nil {
		page := testenv.Decode[board.ElementPage](t, f.env.Call(t, "GET", path+"&cursor="+*cursor, f.token, nil, 200))
		for _, e := range page.Items {
			if seen[e.ID] {
				t.Fatal("cursor repeated an element")
			}
			seen[e.ID] = true
		}
		cursor = page.NextCursor
	}
	if len(seen) != 40 {
		t.Fatalf("pagination lost elements: %d", len(seen))
	}
	f.env.Call(t, "GET", f.path+"/pages/"+f.board.Pages[0].ID+"/elements?revision=8&cursor="+*first.NextCursor, f.token, nil, 422)
}
