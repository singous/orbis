//go:build integration

package document_test

import (
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/tests/testenv"
)

type readWindow struct {
	Items []struct {
		ID       string
		ParentID *string `json:"parent_id"`
		Position int
		Revision int64 `json:"block_revision"`
		Children int   `json:"child_count"`
		Payload  document.Payload
	}
	Version    int64
	Pagination struct {
		Next *string `json:"next_cursor"`
		More bool    `json:"has_more"`
	}
}

func TestShallowWindowsOutlineAndChangeSnapshots(t *testing.T) {
	f := newDocument(t)
	first, second, third := uuid.NewString(), uuid.NewString(), uuid.NewString()
	group := uuid.NewString()
	child := block("movable")
	blocks := []document.Block{{ID: first, Type: "heading", Props: map[string]any{"level": 1}, Content: []document.TextRun{{Text: "First"}}}, {ID: group, Type: "group", Children: []document.Block{{ID: second, Type: "heading", Props: map[string]any{"level": 2}, Content: []document.TextRun{{Text: "Nested"}}}, child}}, {ID: third, Type: "heading", Props: map[string]any{"level": 1}, Content: []document.TextRun{{Text: "Third"}}}}
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Read", blocks), 200)
	roots := testenv.Decode[readWindow](t, f.env.Call(t, "GET", f.path+"/children?version=2&page_size=2", f.session.AccessToken, nil, 200))
	if len(roots.Items) != 2 || roots.Items[0].ID != first || roots.Items[1].ID != group || roots.Items[1].Children != 2 || roots.Items[1].Revision != 2 || roots.Pagination.Next == nil {
		t.Fatal("root window lost order or omitted-child metadata")
	}
	nested := testenv.Decode[readWindow](t, f.env.Call(t, "GET", f.path+"/children?parent_id="+group+"&version=2", f.session.AccessToken, nil, 200))
	if len(nested.Items) != 2 || nested.Items[0].ID != second {
		t.Fatal("nested window was not scoped")
	}
	outline := testenv.Decode[struct {
		Items      []document.Heading
		Pagination struct {
			Next *string `json:"next_cursor"`
		}
	}](t, f.env.Call(t, "GET", f.path+"/outline?version=2&page_size=1", f.session.AccessToken, nil, 200))
	if len(outline.Items) != 1 || outline.Items[0].ID != first || outline.Items[0].RootPosition != 0 || outline.Pagination.Next == nil {
		t.Fatal("outline did not follow tree order")
	}
	next := testenv.Decode[struct{ Items []document.Heading }](t, f.env.Call(t, "GET", f.path+"/outline?page_size=1&cursor="+url.QueryEscape(*outline.Pagination.Next), f.session.AccessToken, nil, 200))
	if len(next.Items) != 1 || next.Items[0].ID != second || next.Items[0].RootPosition != 1 {
		t.Fatal("outline cursor did not retain path order")
	}
	f.env.Call(t, "GET", f.path+"/children?cursor="+url.QueryEscape(*outline.Pagination.Next), f.session.AccessToken, nil, 422)
	position := 0
	command(t, f, 2, document.Operation{Type: "move_block", BlockID: child.ID, Position: &position})
	currentOutline := testenv.Decode[struct{ Items []document.Heading }](t, f.env.Call(t, "GET", f.path+"/outline?version=3", f.session.AccessToken, nil, 200))
	if len(currentOutline.Items) != 3 || currentOutline.Items[1].RootPosition != 2 {
		t.Fatal("outline root position was not bound to the requested document snapshot")
	}
	old := testenv.Decode[readWindow](t, f.env.Call(t, "GET", f.path+"/children?parent_id="+group+"&version=2", f.session.AccessToken, nil, 200))
	if len(old.Items) != 2 {
		t.Fatal("historical child window shifted after movement")
	}
	changes := testenv.Decode[struct {
		Items   []document.BlockChange
		Version int64
	}](t, f.env.Call(t, "GET", f.path+"/changes?since_version=2&version=3", f.session.AccessToken, nil, 200))
	found := false
	for _, change := range changes.Items {
		if change.ID == child.ID {
			found = true
			if change.ParentID != nil || change.PreviousParentID == nil || *change.PreviousParentID != group {
				t.Fatal("diff omitted the old parent needed by lazy clients")
			}
		}
	}
	if !found || changes.Version != 3 {
		t.Fatal("movement was missing from diff")
	}
	single := testenv.Decode[struct {
		Version int64
		Item    struct {
			Children int `json:"child_count"`
		}
	}](t, f.env.Call(t, "GET", f.path+"/blocks/"+group+"?version=3", f.session.AccessToken, nil, 200))
	if single.Item.Children != 1 {
		t.Fatal("single-block child descriptor was stale")
	}
	f.env.Call(t, "GET", f.path+"/changes?since_version=3&version=2", f.session.AccessToken, nil, 422)
	f.env.Call(t, "GET", f.path+"/children?parent_id="+uuid.NewString(), f.session.AccessToken, nil, 404)
}

func TestFlatBlocksRejectMissingHistoricalRevision(t *testing.T) {
	f := newDocument(t)
	entry := block("Earlier")
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Sparse", []document.Block{entry}), 200)
	entry.Content = []document.TextRun{{Text: "Current"}}
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(2, uuid.NewString(), "Sparse", []document.Block{entry}), 200)
	// A converted history can have nonconsecutive version markers. Numeric bounds alone do not establish a snapshot.
	did := strings.Split(f.path, "/")[len(strings.Split(f.path, "/"))-1]
	tx := f.env.DB.Begin()
	defer tx.Rollback()
	for _, query := range []string{"DELETE FROM document_operations WHERE document_id=? AND result_version=2", "DELETE FROM document_block_versions WHERE document_id=? AND valid_from=2", "DELETE FROM document_revisions WHERE document_id=? AND version=2"} {
		if err := tx.Exec(query, did).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit().Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "GET", f.path+"/blocks?version=2", f.session.AccessToken, nil, 404)
	f.env.Call(t, "GET", f.path+"/blocks?version=3", f.session.AccessToken, nil, 200)
}

func TestBlockWindowsDeferLargePayloadsWithoutLosingMetadataOrCursorScope(t *testing.T) {
	f := newDocument(t)
	large, small := block(strings.Repeat("large readable text ", 12000)), block("small readable text")
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Deferred payloads", []document.Block{large, small}), 200)
	type item struct {
		ID      string
		Type    string `json:"block_type"`
		Payload *document.Payload
		Loaded  bool `json:"payload_loaded"`
		Bytes   int  `json:"payload_bytes"`
	}
	window := testenv.Decode[struct {
		Items   []item
		Version int64
	}](t, f.env.Call(t, "GET", f.path+"/children?version=2&page_size=2", f.session.AccessToken, nil, 200))
	if len(window.Items) != 2 || window.Items[0].ID != large.ID || window.Items[0].Type != "paragraph" || window.Items[0].Loaded || window.Items[0].Payload != nil || window.Items[0].Bytes <= 128<<10 {
		t.Fatal("large payload was not represented by honest deferred metadata")
	}
	if !window.Items[1].Loaded || window.Items[1].Payload == nil || window.Items[1].Payload.Content[0].Text != "small readable text" {
		t.Fatal("a deferred large block prevented smaller payloads from loading")
	}
	single := testenv.Decode[struct {
		Item    item
		Version int64
	}](t, f.env.Call(t, "GET", f.path+"/blocks/"+large.ID+"?version=2", f.session.AccessToken, nil, 200))
	if !single.Item.Loaded || single.Item.Payload == nil || single.Item.Payload.Content[0].Text != large.Content[0].Text || single.Item.Bytes != window.Items[0].Bytes || single.Version != 2 {
		t.Fatal("single-block loading did not return the complete original snapshot")
	}
	base := "/api/v1/workspaces/" + f.workspaceID
	token := testenv.Decode[struct{ Token string }](t, f.env.Call(t, "POST", base+"/integration-tokens", f.session.AccessToken, map[string]any{"name": "Deferred-reader", "document_id": f.documentID, "permissions": []string{"documents:read"}}, 201))
	agent := "/api/v1/agent/workspaces/" + f.workspaceID + "/documents/" + f.documentID
	agentWindow := testenv.Decode[struct{ Items []item }](t, f.env.Call(t, "GET", agent+"/children?version=2", token.Token, nil, 200))
	if agentWindow.Items[0].Payload != nil || agentWindow.Items[0].Loaded {
		t.Fatal("Agent windows bypassed the shared response payload budget")
	}
	f.env.Call(t, "GET", agent+"/blocks/"+large.ID+"?version=2", token.Token, nil, 200)
}
