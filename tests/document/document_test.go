//go:build integration

package document_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/tests/testenv"
)

type fixture struct {
	env          *testenv.Environment
	session      testenv.Session
	workspaceID  string
	collectionID string
	documentID   string
	path         string
}

func newDocument(t *testing.T) fixture {
	t.Helper()
	return newDocumentWithEnvironment(t, testenv.New(t))
}

func newDocumentWithEnvironment(t *testing.T, env *testenv.Environment) fixture {
	t.Helper()
	session, workspaceID := env.Owner(t)
	root := "/api/v1/workspaces/" + workspaceID
	collection := testenv.Decode[struct {
		ID string `json:"id"`
	}](t,
		env.Call(
			t,
			"POST",
			root+"/collections",
			session.AccessToken,
			map[string]any{"title": "Test Collection"},
			http.StatusCreated,
		))
	created := env.Call(
		t,
		"POST",
		root+"/collections/"+collection.ID+"/documents",
		session.AccessToken,
		map[string]any{"title": "Initial"},
		http.StatusCreated,
	)
	doc := testenv.Decode[struct {
		ID           string `json:"id"`
		CreatedAtMS  int64  `json:"created_at_ms"`
		UpdatedAtMS  int64  `json:"updated_at_ms"`
		ArchivedAtMS *int64 `json:"archived_at_ms"`
	}](t, created)
	if doc.CreatedAtMS != doc.UpdatedAtMS || time.Since(time.UnixMilli(doc.CreatedAtMS)).Abs() > time.Minute {
		t.Fatal("document timestamps are not consistent Unix milliseconds")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(created.Data, &fields); err != nil {
		t.Fatal(err)
	}
	if string(fields["archived_at_ms"]) != "null" {
		t.Fatal("optional timestamp must be explicitly null")
	}
	return fixture{
		env:          env,
		session:      session,
		workspaceID:  workspaceID,
		collectionID: collection.ID,
		documentID:   doc.ID,
		path:         root + "/documents/" + doc.ID,
	}
}

type content struct {
	Revision struct {
		Version             int64  `json:"version"`
		Title               string `json:"title"`
		RestoredFromVersion *int64 `json:"restored_from_version"`
	} `json:"revision"`
	Blocks []document.Block `json:"blocks"`
}

func block(text string) document.Block {
	return document.Block{
		ID:       uuid.NewString(),
		Type:     "paragraph",
		Props:    map[string]any{},
		Content:  []document.TextRun{{Text: text, Marks: []string{}}},
		Children: []document.Block{},
	}
}

func writeBody(expected int64, operation, title string, blocks []document.Block) map[string]any {
	return map[string]any{"expected_version": expected, "operation_id": operation, "title": title, "blocks": blocks}
}

func TestVersionedEditingJourney(t *testing.T) {
	f := newDocument(t)
	initial := testenv.Decode[content](t, f.env.Call(
		t,
		"GET",
		f.path+"/content",
		f.session.AccessToken,
		nil,
		http.StatusOK,
	))
	if initial.Revision.Version != 1 || initial.Blocks == nil || len(initial.Blocks) != 0 {
		t.Fatal("new document must have an empty first revision")
	}
	child := block("nested text")
	group := document.Block{
		ID:       uuid.NewString(),
		Type:     "group",
		Props:    map[string]any{},
		Content:  []document.TextRun{},
		Children: []document.Block{child},
	}
	blocks := []document.Block{group, block("second root")}
	operation := uuid.NewString()
	body := writeBody(
		1,
		operation,
		"First edit",
		blocks,
	)
	saved := testenv.Decode[content](t, f.env.Call(
		t,
		"PUT",
		f.path+"/content",
		f.session.AccessToken,
		body,
		http.StatusOK,
	))
	if saved.Revision.Version != 2 || len(saved.Blocks) != 2 || saved.Blocks[0].Children[0].Content[0].Text != "nested text" {
		t.Fatal("nested content was not saved")
	}
	retried := testenv.Decode[content](t, f.env.Call(
		t,
		"PUT",
		f.path+"/content",
		f.session.AccessToken,
		body,
		http.StatusOK,
	))
	if retried.Revision.Version != 2 {
		t.Fatal("retry created a new revision")
	}
	conflict := f.env.Call(
		t,
		"PUT",
		f.path+"/content",
		f.session.AccessToken,
		writeBody(
			1,
			operation,
			"Different intent",
			blocks,
		),
		http.StatusConflict,
	)
	if conflict.Code != "IDEMPOTENCY_CONFLICT" {
		t.Fatalf("unexpected conflict code %s", conflict.Code)
	}
	conflict = f.env.Call(
		t,
		"PUT",
		f.path+"/content",
		f.session.AccessToken,
		writeBody(
			1,
			uuid.NewString(),
			"Stale",
			blocks,
		),
		http.StatusConflict,
	)
	if conflict.Code != "DOCUMENT_VERSION_CONFLICT" {
		t.Fatalf("unexpected conflict code %s", conflict.Code)
	}
	f.env.Call(
		t,
		"PUT",
		f.path+"/content",
		f.session.AccessToken,
		writeBody(
			2,
			uuid.NewString(),
			"Moved child",
			[]document.Block{child},
		),
		http.StatusOK,
	)
	history := testenv.Decode[content](t, f.env.Call(
		t,
		"GET",
		f.path+"/content?version=2",
		f.session.AccessToken,
		nil,
		http.StatusOK,
	))
	if len(history.Blocks) != 2 || history.Blocks[0].Children[0].ID != child.ID {
		t.Fatal("current edit changed historical blocks")
	}
	first := testenv.Decode[content](t, f.env.Call(
		t,
		"GET",
		f.path+"/content?version=1",
		f.session.AccessToken,
		nil,
		http.StatusOK,
	))
	if len(first.Blocks) != 0 {
		t.Fatal("historical empty revision changed")
	}
	restored := testenv.Decode[content](t, f.env.Call(
		t,
		"POST",
		f.path+"/restore",
		f.session.AccessToken,
		map[string]any{
			"operation_id": uuid.NewString(), "expected_version": 3, "source_version": 2,
		},
		http.StatusOK,
	))
	if restored.Revision.Version != 4 || restored.Revision.RestoredFromVersion == nil || *restored.Revision.RestoredFromVersion != 2 || len(restored.Blocks) != 2 {
		t.Fatal("history restore did not create a new revision")
	}
	list := testenv.Decode[struct {
		Items      []any                                 `json:"items"`
		Pagination struct{ Page, PageSize, Total int64 } `json:"pagination"`
	}](t,
		f.env.Call(
			t,
			"GET",
			f.path+"/revisions?page=2&page_size=2",
			f.session.AccessToken,
			nil,
			http.StatusOK,
		))
	if len(list.Items) != 2 || list.Pagination.Total != 4 || list.Pagination.Page != 2 {
		t.Fatal("revision pagination is incorrect")
	}
	f.env.Call(
		t,
		"GET",
		f.path+"/revisions?page_size=101",
		f.session.AccessToken,
		nil,
		http.StatusUnprocessableEntity,
	)
	empty := testenv.Decode[struct {
		Items []any `json:"items"`
	}](t, f.env.Call(
		t,
		"GET",
		f.path+"/revisions?page=99",
		f.session.AccessToken,
		nil,
		http.StatusOK,
	))
	if empty.Items == nil || len(empty.Items) != 0 {
		t.Fatal("out-of-range page must return an empty array")
	}
}

func TestConcurrentWritesAreAtomic(t *testing.T) {
	f := newDocument(t)
	results := make(chan testenv.Result, 8)
	errors := make(chan error, 8)
	var workers sync.WaitGroup
	for index := range 8 {
		workers.Go(func() {
			result, err := f.env.Do(
				"PUT",
				f.path+"/content",
				f.session.AccessToken,
				writeBody(
					1,
					uuid.NewString(),
					fmt.Sprintf("Writer %d", index),
					[]document.Block{block("winner")},
				),
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
	counts := map[int]int{}
	for result := range results {
		counts[result.Status]++
	}
	if counts[http.StatusOK] != 1 || counts[http.StatusConflict] != 7 {
		t.Fatalf("unexpected write statuses: %v", counts)
	}
	actual := testenv.Decode[content](t, f.env.Call(
		t,
		"GET",
		f.path+"/content",
		f.session.AccessToken,
		nil,
		http.StatusOK,
	))
	if actual.Revision.Version != 2 || len(actual.Blocks) != 1 {
		t.Fatal("conflicting writes affected the committed content")
	}
	var receipts int64
	if err := f.env.DB.Table("document_operations").Where("document_id = ?", f.documentID).Count(&receipts).Error; err != nil {
		t.Fatal(err)
	}
	if receipts != 1 {
		t.Fatal("rejected writes left committed operation receipts")
	}
}

func TestWriteRollsBackWhenReceiptFails(t *testing.T) {
	f := newDocument(t)
	if err := f.env.DB.Exec("ALTER TABLE document_operations ADD CONSTRAINT reject_test_receipt CHECK (FALSE)").Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(
		t,
		"PUT",
		f.path+"/content",
		f.session.AccessToken,
		writeBody(
			1,
			uuid.NewString(),
			"Must roll back",
			[]document.Block{block("not committed")},
		),
		http.StatusInternalServerError,
	)
	actual := testenv.Decode[content](t, f.env.Call(
		t,
		"GET",
		f.path+"/content",
		f.session.AccessToken,
		nil,
		http.StatusOK,
	))
	if actual.Revision.Version != 1 || actual.Revision.Title != "Initial" || len(actual.Blocks) != 0 {
		t.Fatal("content escaped the failed transaction")
	}
	var revisions int64
	if err := f.env.DB.Table("document_revisions").Where("document_id = ?", f.documentID).Count(&revisions).Error; err != nil {
		t.Fatal(err)
	}
	if revisions != 1 {
		t.Fatal("failed transaction left a historical revision")
	}
}

func TestCursorRetainsVersionAndScope(t *testing.T) {
	f := newDocument(t)
	blocks := []document.Block{block("one"), block("two"), block("three")}
	f.env.Call(
		t,
		"PUT",
		f.path+"/content",
		f.session.AccessToken,
		writeBody(
			1,
			uuid.NewString(),
			"Cursor snapshot",
			blocks,
		),
		http.StatusOK,
	)
	type cursorPage struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
		Version    int64 `json:"version"`
		Pagination struct {
			NextCursor *string `json:"next_cursor"`
			HasMore    bool    `json:"has_more"`
		} `json:"pagination"`
	}
	first := testenv.Decode[cursorPage](t, f.env.Call(
		t,
		"GET",
		f.path+"/blocks?page_size=1",
		f.session.AccessToken,
		nil,
		http.StatusOK,
	))
	if len(first.Items) != 1 || first.Pagination.NextCursor == nil {
		t.Fatal("first block cursor is missing")
	}
	f.env.Call(
		t,
		"PUT",
		f.path+"/content",
		f.session.AccessToken,
		writeBody(
			2,
			uuid.NewString(),
			"New content",
			[]document.Block{},
		),
		http.StatusOK,
	)
	seen := map[string]bool{first.Items[0].ID: true}
	cursor := first.Pagination.NextCursor
	for cursor != nil {
		page := testenv.Decode[cursorPage](t, f.env.Call(
			t,
			"GET",
			f.path+"/blocks?page_size=1&cursor="+url.QueryEscape(*cursor),
			f.session.AccessToken,
			nil,
			http.StatusOK,
		))
		if page.Version != 2 {
			t.Fatal("cursor drifted to a new content version")
		}
		for _, item := range page.Items {
			if seen[item.ID] {
				t.Fatal("duplicate block across cursor pages")
			}
			seen[item.ID] = true
		}
		if page.Pagination.HasMore != (page.Pagination.NextCursor != nil) {
			t.Fatal("cursor end markers disagree")
		}
		cursor = page.Pagination.NextCursor
	}
	if len(seen) != 3 {
		t.Fatal("cursor lost historical blocks")
	}
	f.env.Call(
		t,
		"GET",
		f.path+"/blocks?version=3&cursor="+url.QueryEscape(*first.Pagination.NextCursor),
		f.session.AccessToken,
		nil,
		http.StatusUnprocessableEntity,
	)
	f.env.Call(
		t,
		"GET",
		f.path+"/blocks?cursor=invalid",
		f.session.AccessToken,
		nil,
		http.StatusUnprocessableEntity,
	)
	other := testenv.Decode[struct {
		ID string `json:"id"`
	}](t, f.env.Call(
		t,
		"POST",
		"/api/v1/workspaces/"+f.workspaceID+"/collections/"+f.collectionID+"/documents",
		f.session.AccessToken,
		map[string]any{"title": "Other"},
		http.StatusCreated,
	))
	f.env.Call(
		t,
		"GET",
		"/api/v1/workspaces/"+f.workspaceID+"/documents/"+other.ID+"/blocks?cursor="+url.QueryEscape(*first.Pagination.NextCursor),
		f.session.AccessToken,
		nil,
		http.StatusUnprocessableEntity,
	)
}

func TestWorkspaceAndRoleIsolation(t *testing.T) {
	f := newDocument(t)
	viewer := f.env.AddUser(t, "viewer@example.test")
	outsider := f.env.AddUser(t, "outsider@example.test")
	now := time.Now().UnixMilli()
	if err := f.env.DB.Exec(
		"INSERT INTO workspace_members (workspace_id,user_id,role,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?)",
		f.workspaceID,
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
		f.path+"/content",
		viewer.AccessToken,
		nil,
		http.StatusOK,
	)
	f.env.Call(
		t,
		"PUT",
		f.path+"/content",
		viewer.AccessToken,
		writeBody(
			1,
			uuid.NewString(),
			"Forbidden",
			[]document.Block{},
		),
		http.StatusForbidden,
	)
	f.env.Call(
		t,
		"GET",
		f.path+"/content",
		outsider.AccessToken,
		nil,
		http.StatusNotFound,
	)
	other := testenv.Decode[struct {
		ID string `json:"id"`
	}](t, f.env.Call(
		t,
		"POST",
		"/api/v1/workspaces",
		f.session.AccessToken,
		map[string]any{"name": "Other workspace"},
		http.StatusCreated,
	))
	f.env.Call(
		t,
		"GET",
		"/api/v1/workspaces/"+other.ID+"/documents/"+f.documentID+"/content",
		f.session.AccessToken,
		nil,
		http.StatusNotFound,
	)
	f.env.Call(
		t,
		"POST",
		"/api/v1/workspaces/"+other.ID+"/collections/"+f.collectionID+"/documents",
		f.session.AccessToken,
		map[string]any{"title": "Wrong workspace"},
		http.StatusNotFound,
	)
}
