package command

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBoardExportPinsRevisionAcrossPages(t *testing.T) {
	pageID := "693dc42c-2ad0-454b-a625-64d7d8675707"
	reads := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/boards/"+oid):
			respond(w, 200, map[string]any{"id": oid, "document_id": wid, "revision": 8, "pages": []any{map[string]any{"id": pageID}}})
		case strings.Contains(r.URL.Path, "/pages/"):
			reads++
			if r.URL.Query().Get("revision") != "8" {
				t.Error("export read a moving revision")
			}
			if reads == 1 {
				respond(w, 200, map[string]any{"revision": 8, "items": []any{map[string]any{"id": "first"}}, "has_more": true, "next_cursor": "cursor"})
			} else {
				if r.URL.Query().Get("cursor") != "cursor" {
					t.Error("cursor lost")
				}
				respond(w, 200, map[string]any{"revision": 8, "items": []any{map[string]any{"id": "second"}}, "has_more": false, "next_cursor": nil})
			}
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	runtime, out, _, _ := runtimeFor(t, server.URL)
	path := filepath.Join(t.TempDir(), "board.orbis-board.json")
	run(t, runtime, out, 0, "boards", "export", oid, "--out", path, "--allow-http")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Format   string
		Elements []any
		Assets   []any
	}
	if json.Unmarshal(data, &file) != nil || file.Format != "orbis.board" || len(file.Elements) != 2 || file.Assets == nil {
		t.Fatal("incomplete portable export")
	}
}

func TestTemplateInsertionRetainsIdentityAndRewritesBindingsAcrossRetries(t *testing.T) {
	pageID := "693dc42c-2ad0-454b-a625-64d7d8675707"
	shape := func(id string) map[string]any {
		return map[string]any{"id": id, "page_id": pageID, "structure": map[string]any{"parent_id": nil, "members": []any{}, "start": nil, "end": nil}}
	}
	a, b, edge := shape(oid), shape(wid), shape(pageID)
	edge["structure"] = map[string]any{"parent_id": nil, "members": []any{}, "start": map[string]any{"element_id": oid, "port": "right"}, "end": map[string]any{"element_id": wid, "port": "left"}}
	var received [][]byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/board-templates") {
			respond(w, 200, map[string]any{"schema_version": 1, "templates": []any{map[string]any{"id": "flow.example", "version": 1, "elements": []any{a, b, edge}}}})
			return
		}
		if !strings.HasSuffix(r.URL.Path, "/commands") {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		encoded, _ := json.Marshal(payload)
		received = append(received, encoded)
		commands := payload["commands"].([]any)
		elements := commands[0].(map[string]any)["elements"].([]any)
		nodeID := elements[0].(map[string]any)["id"]
		connection := elements[2].(map[string]any)["structure"].(map[string]any)
		if connection["start"].(map[string]any)["element_id"] != nodeID || nodeID == oid {
			t.Error("template connector identity was not remapped")
		}
		if elements[0].(map[string]any)["page_id"] != pageID {
			t.Error("target page lost")
		}
		respond(w, 200, map[string]any{"revision": 2})
	}))
	defer server.Close()
	runtime, out, _, _ := runtimeFor(t, server.URL)
	for range 2 {
		run(t, runtime, out, 0, "boards", "template", oid, "--template", "flow.example", "--board-page", pageID, "--operation-id", wid, "--allow-http")
	}
	if len(received) != 2 || !bytes.Equal(received[0], received[1]) {
		t.Fatal("same operation generated a different template")
	}
}
