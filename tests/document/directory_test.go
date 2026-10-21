//go:build integration

package document_test

import (
	"errors"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/tests/testenv"
)

type directoryNode struct {
	ID             string  `json:"id"`
	ParentID       *string `json:"parent_id"`
	Position       int     `json:"position"`
	ContentVersion int64   `json:"content_version"`
	ArchivedAtMS   *int64  `json:"archived_at_ms"`
}

type directoryPage struct {
	Items            []directoryNode `json:"items"`
	DirectoryVersion int64           `json:"directory_version"`
	Pagination       struct {
		Total int64 `json:"total"`
	} `json:"pagination"`
}

func collectionPath(f fixture) string {
	return "/api/v1/workspaces/" + f.workspaceID + "/collections/" + f.collectionID
}
func nodePath(f fixture, id string) string {
	return "/api/v1/workspaces/" + f.workspaceID + "/documents/" + id
}

func createNode(t *testing.T, f fixture, title string, parent *string) directoryNode {
	t.Helper()
	return testenv.Decode[directoryNode](t, f.env.Call(
		t,
		"POST",
		collectionPath(f)+"/documents",
		f.session.AccessToken,
		map[string]any{"title": title, "parent_id": parent},
		http.StatusCreated,
	))
}

func directoryVersion(t *testing.T, f fixture) int64 {
	t.Helper()
	return testenv.Decode[struct {
		Version int64 `json:"directory_version"`
	}](t, f.env.Call(
		t,
		"GET",
		collectionPath(f),
		f.session.AccessToken,
		nil,
		200,
	)).Version
}

func children(t *testing.T, f fixture, parent *string) directoryPage {
	t.Helper()
	path := collectionPath(f) + "/children?page_size=100"
	if parent != nil {
		path += "&parent_id=" + *parent
	}
	return testenv.Decode[directoryPage](t, f.env.Call(
		t,
		"GET",
		path,
		f.session.AccessToken,
		nil,
		200,
	))
}

func archiveNode(t *testing.T, f fixture, id string, archived bool, status int) testenv.Result {
	t.Helper()
	return f.env.Call(
		t,
		"PUT",
		nodePath(f, id)+"/archive",
		f.session.AccessToken,
		map[string]any{"archived": archived, "expected_directory_version": directoryVersion(t, f)},
		status,
	)
}

func TestDirectoryMoveReorderAndPatchPresence(t *testing.T) {
	f := newDocument(t)
	second := createNode(
		t,
		f,
		"Second",
		nil,
	)
	child := createNode(
		t,
		f,
		"Child",
		&f.documentID,
	)
	grandchild := createNode(
		t,
		f,
		"Grandchild",
		&child.ID,
	)
	root := children(t, f, nil)
	if len(root.Items) != 2 || root.Items[0].ID != f.documentID || root.Items[1].ID != second.ID {
		t.Fatal("root sibling order is incorrect")
	}
	if page := children(t, f, &f.documentID); len(page.Items) != 1 || page.Items[0].ID != child.ID {
		t.Fatal("nested child is missing")
	}
	f.env.Call(
		t,
		"PATCH",
		nodePath(f, child.ID)+"/location",
		f.session.AccessToken,
		map[string]any{"expected_directory_version": root.DirectoryVersion, "position": 0},
		200,
	)
	unchanged := testenv.Decode[directoryNode](t, f.env.Call(
		t,
		"GET",
		nodePath(f, child.ID),
		f.session.AccessToken,
		nil,
		200,
	))
	if unchanged.ParentID == nil || *unchanged.ParentID != f.documentID {
		t.Fatal("omitted parent_id changed the parent")
	}
	f.env.Call(
		t,
		"PATCH",
		nodePath(f, child.ID)+"/location",
		f.session.AccessToken,
		map[string]any{"expected_directory_version": directoryVersion(t, f), "parent_id": nil},
		200,
	)
	moved := testenv.Decode[directoryNode](t, f.env.Call(
		t,
		"GET",
		nodePath(f, child.ID),
		f.session.AccessToken,
		nil,
		200,
	))
	if moved.ParentID != nil || moved.Position != 2 || moved.ContentVersion != 1 {
		t.Fatal("explicit null did not move to root without changing content")
	}
	cycle := f.env.Call(
		t,
		"PATCH",
		nodePath(f, child.ID)+"/location",
		f.session.AccessToken,
		map[string]any{"expected_directory_version": directoryVersion(t, f), "parent_id": grandchild.ID},
		409,
	)
	if cycle.Code != "DOCUMENT_PARENT_CYCLE" {
		t.Fatal("descendant cycle was not rejected")
	}
	for _, body := range []map[string]any{
		{"expected_directory_version": directoryVersion(t, f)},
		{"expected_directory_version": directoryVersion(t, f), "position": nil},
	} {
		f.env.Call(
			t,
			"PATCH",
			nodePath(f, child.ID)+"/location",
			f.session.AccessToken,
			body,
			422,
		)
	}
	root = children(t, f, nil)
	ids := []string{child.ID, second.ID, f.documentID}
	f.env.Call(
		t,
		"PUT",
		collectionPath(f)+"/order",
		f.session.AccessToken,
		map[string]any{
			"expected_directory_version": root.DirectoryVersion, "document_ids": ids, "parent_id": nil,
		},
		200,
	)
	after := children(t, f, nil)
	for i, node := range after.Items {
		if node.ID != ids[i] || node.Position != i {
			t.Fatal("reorder did not persist contiguous sibling positions")
		}
	}
	f.env.Call(
		t,
		"PUT",
		collectionPath(f)+"/order",
		f.session.AccessToken,
		map[string]any{
			"expected_directory_version": root.DirectoryVersion, "document_ids": ids,
		},
		409,
	)
	for _, invalid := range [][]string{{child.ID}, {child.ID, child.ID, f.documentID}, {child.ID, second.ID, grandchild.ID}} {
		f.env.Call(
			t,
			"PUT",
			collectionPath(f)+"/order",
			f.session.AccessToken,
			map[string]any{
				"expected_directory_version": after.DirectoryVersion, "document_ids": invalid,
			},
			409,
		)
	}
	if latest := children(t, f, nil); latest.DirectoryVersion != after.DirectoryVersion || latest.Items[0].ID != child.ID {
		t.Fatal("rejected reorder changed directory state")
	}
	if nested := children(t, f, &child.ID); len(nested.Items) != 1 || nested.Items[0].ID != grandchild.ID {
		t.Fatal("moving a parent changed its subtree")
	}
}

func TestArchiveVisibilityAndRestorationDependencies(t *testing.T) {
	f := newDocument(t)
	active := createNode(
		t,
		f,
		"Active child",
		&f.documentID,
	)
	archived := createNode(
		t,
		f,
		"Independently archived",
		&f.documentID,
	)
	grandchild := createNode(
		t,
		f,
		"Grandchild",
		&active.ID,
	)
	archiveNode(
		t,
		f,
		archived.ID,
		true,
		200,
	)
	archiveNode(
		t,
		f,
		f.documentID,
		true,
		200,
	)
	for _, id := range []string{f.documentID, active.ID, archived.ID, grandchild.ID} {
		for _, suffix := range []string{"", "/content?version=1", "/revisions", "/blocks"} {
			f.env.Call(
				t,
				"GET",
				nodePath(f, id)+suffix,
				f.session.AccessToken,
				nil,
				404,
			)
		}
	}
	page := children(t, f, nil)
	if len(page.Items) != 0 || page.Pagination.Total != 0 {
		t.Fatal("archived subtree leaked through directory listing")
	}
	all := testenv.Decode[struct {
		Items []directoryNode `json:"items"`
	}](t, f.env.Call(
		t,
		"GET",
		collectionPath(f)+"/documents",
		f.session.AccessToken,
		nil,
		200,
	))
	if len(all.Items) != 0 {
		t.Fatal("archived ancestor leaked through flat document listing")
	}
	explicit := testenv.Decode[struct {
		Items []directoryNode `json:"items"`
	}](t, f.env.Call(
		t,
		"GET",
		"/api/v1/workspaces/"+f.workspaceID+"/documents/archive",
		f.session.AccessToken,
		nil,
		200,
	))
	if len(explicit.Items) != 2 {
		t.Fatal("archive list changed descendant archive states")
	}
	dependency := archiveNode(
		t,
		f,
		grandchild.ID,
		false,
		409,
	)
	if dependency.Code != "ARCHIVE_PARENT_INACTIVE" {
		t.Fatal("restoration ignored a non-immediate archived ancestor")
	}
	archiveNode(
		t,
		f,
		f.documentID,
		false,
		200,
	)
	f.env.Call(
		t,
		"GET",
		nodePath(f, active.ID),
		f.session.AccessToken,
		nil,
		200,
	)
	f.env.Call(
		t,
		"GET",
		nodePath(f, grandchild.ID),
		f.session.AccessToken,
		nil,
		200,
	)
	f.env.Call(
		t,
		"GET",
		nodePath(f, archived.ID),
		f.session.AccessToken,
		nil,
		404,
	)
	f.env.Call(
		t,
		"PUT",
		collectionPath(f)+"/archive",
		f.session.AccessToken,
		map[string]any{"archived": true, "expected_directory_version": directoryVersion(t, f)},
		200,
	)
	f.env.Call(
		t,
		"GET",
		nodePath(f, grandchild.ID)+"/content",
		f.session.AccessToken,
		nil,
		404,
	)
	archiveNode(
		t,
		f,
		archived.ID,
		false,
		409,
	)
	collections := testenv.Decode[struct {
		Items []any `json:"items"`
	}](t, f.env.Call(
		t,
		"GET",
		"/api/v1/workspaces/"+f.workspaceID+"/collections?archived=true",
		f.session.AccessToken,
		nil,
		200,
	))
	if len(collections.Items) != 1 {
		t.Fatal("archived collection listing is incorrect")
	}
	f.env.Call(
		t,
		"PUT",
		collectionPath(f)+"/archive",
		f.session.AccessToken,
		map[string]any{"archived": false, "expected_directory_version": directoryVersion(t, f)},
		200,
	)
	f.env.Call(
		t,
		"GET",
		nodePath(f, archived.ID),
		f.session.AccessToken,
		nil,
		404,
	)
	restored := testenv.Decode[struct {
		Document directoryNode `json:"document"`
	}](t, archiveNode(
		t,
		f,
		archived.ID,
		false,
		200,
	))
	if restored.Document.ArchivedAtMS != nil {
		t.Fatal("restored timestamp must be null")
	}
	f.env.Call(
		t,
		"GET",
		nodePath(f, archived.ID)+"/content",
		f.session.AccessToken,
		nil,
		200,
	)
}

func TestConcurrentOppositeMovesCannotCreateCycle(t *testing.T) {
	f := newDocument(t)
	other := createNode(
		t,
		f,
		"Other",
		nil,
	)
	version := directoryVersion(t, f)
	results := make(chan testenv.Result, 2)
	errors := make(chan error, 2)
	var workers sync.WaitGroup
	for _, pair := range [][2]string{{f.documentID, other.ID}, {other.ID, f.documentID}} {
		workers.Go(func() {
			result, err := f.env.Do(
				"PATCH",
				nodePath(f, pair[0])+"/location",
				f.session.AccessToken,
				map[string]any{"expected_directory_version": version, "parent_id": pair[1]},
			)
			results <- result
			errors <- err
		})
	}
	workers.Wait()
	close(results)
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	statuses := map[int]int{}
	for result := range results {
		statuses[result.Status]++
	}
	if statuses[200] != 1 || statuses[409] != 1 {
		t.Fatalf("unexpected opposite move statuses: %v", statuses)
	}
	root := children(t, f, nil)
	if len(root.Items) != 1 {
		t.Fatal("opposite moves corrupted the roots")
	}
	below := children(t, f, &root.Items[0].ID)
	if len(below.Items) != 1 {
		t.Fatal("opposite moves lost a document")
	}
	conflict := f.env.Call(
		t,
		"PATCH",
		nodePath(f, root.Items[0].ID)+"/location",
		f.session.AccessToken,
		map[string]any{"expected_directory_version": root.DirectoryVersion, "parent_id": below.Items[0].ID},
		409,
	)
	if conflict.Code != "DOCUMENT_PARENT_CYCLE" {
		t.Fatal("cycle was accepted after retry with a fresh version")
	}
}

func TestConcurrentCreateAndReorderPreserveSiblingSet(t *testing.T) {
	f := newDocument(t)
	other := createNode(
		t,
		f,
		"Other",
		nil,
	)
	version := directoryVersion(t, f)
	type outcome struct {
		result testenv.Result
		err    error
	}
	created, reordered := make(chan outcome, 1), make(chan outcome, 1)
	go func() {
		result, err := f.env.Do(
			"POST",
			collectionPath(f)+"/documents",
			f.session.AccessToken,
			map[string]any{"title": "Concurrent"},
		)
		created <- outcome{result: result, err: err}
	}()
	go func() {
		result, err := f.env.Do(
			"PUT",
			collectionPath(f)+"/order",
			f.session.AccessToken,
			map[string]any{"expected_directory_version": version, "document_ids": []string{other.ID, f.documentID}},
		)
		reordered <- outcome{result: result, err: err}
	}()
	a, b := <-created, <-reordered
	if a.err != nil {
		t.Fatal(a.err)
	}
	if b.err != nil {
		t.Fatal(b.err)
	}
	if a.result.Status != 201 || (b.result.Status != 200 && b.result.Status != 409) {
		t.Fatalf("unexpected create/reorder statuses: %d/%d", a.result.Status, b.result.Status)
	}
	root := children(t, f, nil)
	if len(root.Items) != 3 {
		t.Fatal("concurrent create was lost by reorder")
	}
	seen := map[string]bool{}
	for i, node := range root.Items {
		if node.Position != i || seen[node.ID] {
			t.Fatal("sibling order is inconsistent")
		}
		seen[node.ID] = true
	}
}

func TestDirectoryRejectsCrossCollectionScope(t *testing.T) {
	f := newDocument(t)
	other := testenv.Decode[struct {
		ID      string `json:"id"`
		Version int64  `json:"directory_version"`
	}](t,
		f.env.Call(
			t,
			"POST",
			"/api/v1/workspaces/"+f.workspaceID+"/collections",
			f.session.AccessToken,
			map[string]any{"title": "Other"},
			201,
		))
	newNode := testenv.Decode[directoryNode](t, f.env.Call(
		t,
		"POST",
		"/api/v1/workspaces/"+f.workspaceID+"/collections/"+other.ID+"/documents",
		f.session.AccessToken,
		map[string]any{"title": "Other root"},
		201,
	))
	f.env.Call(
		t,
		"PATCH",
		nodePath(f, f.documentID)+"/location",
		f.session.AccessToken,
		map[string]any{"expected_directory_version": directoryVersion(t, f), "parent_id": newNode.ID},
		404,
	)
	repo := docstore.New(f.env.DB)
	_, err := repo.Archive(t.Context(), document.ArchiveChange{
		Scope: document.DirectoryScope{
			ActorID:      f.session.User.ID,
			WorkspaceID:  f.workspaceID,
			CollectionID: other.ID,
			DocumentID:   f.documentID,
		},
		ExpectedDirectoryVersion: other.Version + 1, Archived: true,
	})
	var business *fault.Error
	if !errors.As(err, &business) || business.Kind != fault.NotFound {
		t.Fatalf("mismatched collection scope accepted: %v", err)
	}
	f.env.Call(
		t,
		"GET",
		nodePath(f, f.documentID),
		f.session.AccessToken,
		nil,
		200,
	)
	f.env.Call(
		t,
		"GET",
		nodePath(f, newNode.ID),
		f.session.AccessToken,
		nil,
		200,
	)
}

func TestArchiveAndRestoreSerializeAncestorState(t *testing.T) {
	f := newDocument(t)
	child := createNode(
		t,
		f,
		"Archived child",
		&f.documentID,
	)
	archiveNode(
		t,
		f,
		child.ID,
		true,
		200,
	)
	version := directoryVersion(t, f)
	results := make(chan testenv.Result, 2)
	failures := make(chan error, 2)
	var workers sync.WaitGroup
	for _, operation := range []struct {
		id       string
		archived bool
	}{{id: f.documentID, archived: true}, {id: child.ID, archived: false}} {
		workers.Go(func() {
			result, err := f.env.Do(
				"PUT",
				nodePath(f, operation.id)+"/archive",
				f.session.AccessToken,
				map[string]any{"expected_directory_version": version, "archived": operation.archived},
			)
			results <- result
			failures <- err
		})
	}
	workers.Wait()
	close(results)
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	statuses := map[int]int{}
	for result := range results {
		statuses[result.Status]++
	}
	if statuses[200] != 1 || statuses[409] != 1 {
		t.Fatalf("unexpected archive/restore statuses: %v", statuses)
	}
	if got := directoryVersion(t, f); got != version+1 {
		t.Fatal(fmt.Sprintf("directory version = %d", got))
	}
}
