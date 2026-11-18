//go:build integration

package document_test

import (
	"fmt"
	"github.com/google/uuid"
	"strings"
	"testing"
	"time"

	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/tests/testenv"
)

func TestWorkspaceBrowseRespectsAncestorsArchivesAndStablePages(t *testing.T) {
	f := newDocument(t)
	base := "/api/v1/workspaces/" + f.workspaceID
	blockID := uuid.NewString()
	for version, text := range []string{"previous-body-secret", strings.Repeat("中", 300)} {
		f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": version + 1, "title": "Initial", "blocks": []document.Block{{ID: blockID, Type: "paragraph", Content: []document.TextRun{{Text: text}}}}}, 200)
	}
	parent := createNode(t, f, "Hidden parent", nil)
	_ = createNode(t, f, "Hidden descendant", &parent.ID)
	archiveNode(t, f, parent.ID, true, 200)
	f.env.Clock.Advance(time.Second)
	otherCollection := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", base+"/collections", f.session.AccessToken, map[string]any{"title": "Another collection"}, 201))
	other := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", base+"/collections/"+otherCollection.ID+"/documents", f.session.AccessToken, map[string]any{"title": "Latest visible document"}, 201))
	group := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", base+"/collection-groups", f.session.AccessToken, map[string]any{"name": "Hidden group"}, 201))
	hiddenCollection := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", base+"/collections", f.session.AccessToken, map[string]any{"title": "Hidden collection", "group_id": group.ID}, 201))
	f.env.Call(t, "POST", base+"/collections/"+hiddenCollection.ID+"/documents", f.session.AccessToken, map[string]any{"title": "Hidden by group"}, 201)
	f.env.Call(t, "PUT", base+"/collection-groups/"+group.ID+"/archive", f.session.AccessToken, map[string]any{"archived": true, "expected_version": 1}, 200)
	for page, want := range []string{other.ID, f.documentID, ""} {
		result := f.env.Call(t, "GET", fmt.Sprintf("%s/documents?page=%d&page_size=1", base, page+1), f.session.AccessToken, nil, 200)
		value := testenv.Decode[struct {
			Items []struct {
				ID      string
				Summary string
			}
			Pagination struct{ Total int64 }
		}](t, result)
		if value.Pagination.Total != 2 {
			t.Fatalf("workspace browse includes hidden documents: %s", result.Data)
		}
		if want == "" {
			if len(value.Items) != 0 {
				t.Fatal("out-of-range browse is not empty")
			}
		} else if len(value.Items) != 1 || value.Items[0].ID != want {
			t.Fatalf("unstable browse order: %s", result.Data)
		}
		if want == f.documentID && value.Items[0].Summary != strings.Repeat("中", 240) {
			t.Fatal("browse summary is not the bounded current rendered text")
		}
		if strings.Contains(string(result.Data), "previous-body-secret") {
			t.Fatal("browse returned historical content")
		}
		if strings.Contains(string(result.Data), "blocks") || strings.Contains(string(result.Data), "Hidden") {
			t.Fatal("metadata browsing exposed hidden content")
		}
	}
	archive := testenv.Decode[struct {
		Items []struct {
			ID      string
			Summary string
		}
	}](t, f.env.Call(t, "GET", base+"/documents/archive", f.session.AccessToken, nil, 200))
	if len(archive.Items) != 1 || archive.Items[0].ID != parent.ID {
		t.Fatal("archive browse included inherited descendant state")
	}
	outsider := f.env.AddUser(t, "browse-outsider@example.test")
	f.env.Call(t, "GET", base+"/documents", outsider.AccessToken, nil, 404)
	_, _, err := docstore.New(f.env.DB).Browse(t.Context(), document.DirectoryScope{ActorID: outsider.User.ID, WorkspaceID: f.workspaceID}, pagination.Page{Number: 1, Size: 20}, false)
	if err == nil {
		t.Fatal("repository snapshot did not independently verify current membership")
	}
	f.env.Call(t, "GET", base+"/documents?page_size=101", f.session.AccessToken, nil, 422)
	otherSpace := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", "/api/v1/workspaces", f.session.AccessToken, map[string]any{"name": "Other workspace"}, 201))
	otherRoot := "/api/v1/workspaces/" + otherSpace.ID
	collection := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", otherRoot+"/collections", f.session.AccessToken, map[string]any{"title": "Foreign collection"}, 201))
	f.env.Call(t, "POST", otherRoot+"/collections/"+collection.ID+"/documents", f.session.AccessToken, map[string]any{"title": "Other workspace document"}, 201)
	value := testenv.Decode[struct{ Pagination struct{ Total int64 } }](t, f.env.Call(t, "GET", base+"/documents", f.session.AccessToken, nil, 200))
	if value.Pagination.Total != 2 {
		t.Fatal("workspace browse leaked another workspace")
	}
}

func TestCollectionPagePreviews(t *testing.T) {
	f := newDocument(t)
	base := "/api/v1/workspaces/" + f.workspaceID + "/collections"
	hidden := createNode(t, f, "Hidden parent", nil)
	createNode(t, f, "Hidden child", &hidden.ID)
	archiveNode(t, f, hidden.ID, true, 200)
	var newest []string
	for i := 0; i < 4; i++ {
		f.env.Clock.Advance(time.Second)
		node := createNode(t, f, fmt.Sprintf("Document %d", i), nil)
		newest = append([]string{node.ID}, newest...)
	}
	empty := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", base, f.session.AccessToken, map[string]any{"title": "Empty"}, 201))
	result := testenv.Decode[struct {
		Items []struct {
			ID      string
			Preview *struct {
				Count  int
				Recent []struct{ ID string }
			}
		}
	}](t, f.env.Call(t, "GET", base+"?include_preview=true", f.session.AccessToken, nil, 200))
	found := map[string]bool{}
	for _, book := range result.Items {
		found[book.ID] = true
		if book.Preview == nil || book.Preview.Recent == nil {
			t.Fatal("missing preview")
		}
		switch book.ID {
		case f.collectionID:
			if book.Preview.Count != 5 || len(book.Preview.Recent) != 3 {
				t.Fatalf("unexpected preview: %+v", book.Preview)
			}
			for i, item := range book.Preview.Recent {
				if item.ID != newest[i] {
					t.Fatalf("unexpected preview order: %+v", book.Preview.Recent)
				}
			}
		case empty.ID:
			if book.Preview.Count != 0 || len(book.Preview.Recent) != 0 {
				t.Fatal("empty collection contains documents")
			}
		}
	}
	if !found[f.collectionID] || !found[empty.ID] {
		t.Fatal("expected both collections")
	}
	outsider := f.env.AddUser(t, "preview-outsider@example.test")
	_, _, err := docstore.New(f.env.DB).ListCollections(t.Context(), document.CollectionQuery{
		Scope: document.DirectoryScope{WorkspaceID: f.workspaceID, ActorID: outsider.User.ID},
		Page:  pagination.Page{Number: 1, Size: 20}, IncludePreview: true,
	})
	if err == nil {
		t.Fatal("preview exposed document metadata outside the authorized snapshot")
	}
	plain := f.env.Call(t, "GET", base, f.session.AccessToken, nil, 200)
	if strings.Contains(string(plain.Data), `"preview"`) {
		t.Fatal("unexpected preview on default list")
	}
}
