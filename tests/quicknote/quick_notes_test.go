//go:build integration

package quicknote_test

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/tests/testenv"
)

type note struct {
	ID       string           `json:"id"`
	Version  int64            `json:"version"`
	Blocks   []document.Block `json:"blocks"`
	TagIDs   []string         `json:"tag_ids"`
	IsPinned bool             `json:"is_pinned"`
	Created  int64            `json:"created_at_ms"`
	Updated  int64            `json:"updated_at_ms"`
	Deleted  *int64           `json:"deleted_at_ms"`
}
type tag struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
	Count   int64  `json:"count"`
}

func blocks(text string) []document.Block {
	return []document.Block{{ID: uuid.NewString(), Type: "paragraph", Props: map[string]any{}, Content: []document.TextRun{{Text: text, Marks: []string{}}}, Children: []document.Block{}}}
}
func body(text string) map[string]any {
	return map[string]any{"operation_id": uuid.NewString(), "expected_version": 0, "blocks": blocks(text), "tag_ids": []string{}}
}

type fixture struct {
	env       *testenv.Environment
	owner     testenv.Session
	root, wid string
}

func setup(t *testing.T) fixture {
	e := testenv.NewWithCollaboration(t)
	o, w := e.Owner(t)
	return fixture{e, o, "/api/v1/workspaces/" + w, w}
}
func (f fixture) create(t *testing.T, input map[string]any) note {
	return testenv.Decode[note](t, f.env.Call(t, "POST", f.root+"/quick-notes", f.owner.AccessToken, input, 201))
}
func (f fixture) member(t *testing.T) testenv.Session {
	u := f.env.AddUser(t, "member@example.test")
	now := f.env.Clock.Now().UnixMilli()
	if err := f.env.DB.Exec("INSERT INTO workspace_members (workspace_id,user_id,role,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?)", f.wid, u.User.ID, "admin", now, now).Error; err != nil {
		t.Fatal(err)
	}
	return u
}

func TestPersonalCaptureLifecycle(t *testing.T) {
	f := setup(t)
	other := f.member(t)
	input := body("private thought 100% _literal_")
	created := f.create(t, input)
	if created.Version != 1 || created.Created != created.Updated || created.Deleted != nil || created.TagIDs == nil {
		t.Fatal("invalid initial version or timestamps")
	}
	retried := f.create(t, input)
	if retried.ID != created.ID || retried.Version != 1 {
		t.Fatal("retry created a duplicate")
	}
	input["blocks"] = blocks("different intent")
	f.env.Call(t, "POST", f.root+"/quick-notes", f.owner.AccessToken, input, 409)
	path := f.root + "/quick-notes/" + created.ID
	f.env.Call(t, "GET", path, other.AccessToken, nil, 404)
	list := testenv.Decode[struct {
		Items []note `json:"items"`
	}](t, f.env.Call(t, "GET", f.root+"/quick-notes?q=private", other.AccessToken, nil, 200))
	if len(list.Items) != 0 || list.Items == nil {
		t.Fatal("personal records leaked")
	}
	f.env.Call(t, "PATCH", path, other.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "is_deleted": true}, 404)
	f.env.Call(t, "PATCH", path, f.owner.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "is_pinned": nil}, 422)
	patch := map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "is_pinned": true}
	pinned := testenv.Decode[note](t, f.env.Call(t, "PATCH", path, f.owner.AccessToken, patch, 200))
	if !pinned.IsPinned || pinned.Version != 2 {
		t.Fatal("pin did not update version")
	}
	f.env.Call(t, "PATCH", path, f.owner.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "is_pinned": false}, 409)
	patch = map[string]any{"operation_id": uuid.NewString(), "expected_version": 2, "is_deleted": true}
	deleted := testenv.Decode[note](t, f.env.Call(t, "PATCH", path, f.owner.AccessToken, patch, 200))
	if deleted.Deleted == nil {
		t.Fatal("delete must preserve a timestamp")
	}
	active := testenv.Decode[struct {
		Items []note `json:"items"`
	}](t, f.env.Call(t, "GET", f.root+"/quick-notes", f.owner.AccessToken, nil, 200))
	if len(active.Items) != 0 {
		t.Fatal("deleted note remained active")
	}
	f.env.Call(t, "PATCH", path, f.owner.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 3, "is_pinned": false}, 409)
	restored := testenv.Decode[note](t, f.env.Call(t, "PATCH", path, f.owner.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 3, "is_deleted": false}, 200))
	if restored.Deleted != nil || restored.Blocks[0].Content[0].Text != "private thought 100% _literal_" {
		t.Fatal("restore lost content")
	}
	f.env.Call(t, "GET", f.root+"/quick-notes?page_size=101", f.owner.AccessToken, nil, 422)
	f.env.Call(t, "GET", f.root+"/quick-notes?deleted=oops", f.owner.AccessToken, nil, 422)
	f.env.Call(t, "GET", f.root+"/quick-notes?deleted=true&deleted=false", f.owner.AccessToken, nil, 422)
	f.env.Call(t, "GET", f.root+"/quick-notes/not-a-uuid", f.owner.AccessToken, nil, 422)
	f.env.Call(t, "PUT", f.root+"/quick-note-tags/not-a-uuid", f.owner.AccessToken, nil, 422)
	missingVersion := body("missing version")
	delete(missingVersion, "expected_version")
	f.env.Call(t, "POST", f.root+"/quick-notes", f.owner.AccessToken, missingVersion, 422)
	var persisted struct {
		State  []byte `gorm:"column:crdt_state"`
		Blocks json.RawMessage
	}
	if err := f.env.DB.Table("quick_notes").Select("crdt_state,blocks").Where("id=?", created.ID).Take(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	if len(persisted.State) == 0 || len(persisted.Blocks) == 0 {
		t.Fatal("CRDT identity and projection must both be persisted")
	}
	f.env.RestartApplication(t)
	f.env.Call(t, "GET", path, f.owner.AccessToken, nil, 200)
}

func TestTagsRollbackAndDeletion(t *testing.T) {
	f := setup(t)
	other := f.member(t)
	path := f.root + "/quick-note-tags"
	work := testenv.Decode[tag](t, f.env.Call(t, "POST", path, f.owner.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 0, "name": "工作"}, 201))
	f.env.Call(t, "POST", path, f.owner.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 0, "name": "工作"}, 409)
	input := body("tagged note")
	input["tag_ids"] = []string{work.ID}
	n := f.create(t, input)
	foreign := body("must roll back")
	foreign["tag_ids"] = []string{work.ID}
	f.env.Call(t, "POST", f.root+"/quick-notes", other.AccessToken, foreign, 404)
	var count int64
	f.env.DB.Table("quick_notes").Where("owner_id=?", other.User.ID).Count(&count)
	if count != 0 {
		t.Fatal("failed tag validation left a note")
	}
	tags := testenv.Decode[struct {
		Items []tag `json:"items"`
	}](t, f.env.Call(t, "GET", path, f.owner.AccessToken, nil, 200))
	if len(tags.Items) != 1 || tags.Items[0].Count != 1 {
		t.Fatal("tag count did not match active notes")
	}
	f.env.Call(t, "GET", f.root+"/quick-notes?tag_id="+work.ID+"&untagged=true", f.owner.AccessToken, nil, 422)
	f.env.Call(t, "DELETE", path+"/"+work.ID, other.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 1}, 404)
	f.env.Call(t, "DELETE", path+"/"+work.ID, f.owner.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 1}, 200)
	read := testenv.Decode[note](t, f.env.Call(t, "GET", f.root+"/quick-notes/"+n.ID, f.owner.AccessToken, nil, 200))
	if len(read.TagIDs) != 0 || read.Version != 2 || read.Blocks[0].Content[0].Text != "tagged note" {
		t.Fatal("tag deletion must retain and version the note")
	}
	summary := testenv.Decode[struct{ Total, Untagged int64 }](t, f.env.Call(t, "GET", f.root+"/quick-notes/summary", f.owner.AccessToken, nil, 200))
	if summary.Total != 1 || summary.Untagged != 1 {
		t.Fatal("summary mismatches tag deletion")
	}
	input["operation_id"] = uuid.NewString()
	input["expected_version"] = 1
	f.env.Call(t, "PUT", f.root+"/quick-notes/"+n.ID, f.owner.AccessToken, input, 409)
}

func TestConcurrentRetriesAndEdits(t *testing.T) {
	f := setup(t)
	input := body("exactly once")
	var wg sync.WaitGroup
	results := make([]testenv.Result, 2)
	errs := make([]error, 2)
	for i := range 2 {
		wg.Go(func() { results[i], errs[i] = f.env.Do("POST", f.root+"/quick-notes", f.owner.AccessToken, input) })
	}
	wg.Wait()
	for i := range 2 {
		if errs[i] != nil || results[i].Status != 201 {
			t.Fatalf("concurrent create: %v %d", errs[i], results[i].Status)
		}
	}
	a := testenv.Decode[note](t, results[0])
	b := testenv.Decode[note](t, results[1])
	if a.ID != b.ID {
		t.Fatal("concurrent retry duplicated create")
	}
	for i := range 2 {
		wg.Go(func() {
			edit := body("competing edit")
			edit["expected_version"] = 1
			results[i], errs[i] = f.env.Do("PUT", f.root+"/quick-notes/"+a.ID, f.owner.AccessToken, edit)
		})
	}
	wg.Wait()
	statuses := map[int]int{}
	for i := range 2 {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		statuses[results[i].Status]++
	}
	if statuses[200] != 1 || statuses[409] != 1 {
		t.Fatalf("version protection failed: %v", statuses)
	}
}

func TestPrivateAttachmentsAndMembershipRevocation(t *testing.T) {
	f := setup(t)
	other := f.member(t)
	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	part, err := writer.CreateFormFile("file", "thought.txt")
	if err != nil {
		t.Fatal(err)
	}
	part.Write([]byte("personal attachment"))
	writer.Close()
	request := httptest.NewRequest("POST", f.root+"/quick-note-assets", &upload)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+other.AccessToken)
	result, err := f.env.DoRequest(request)
	if err != nil || result.Status != 201 {
		t.Fatalf("upload: %v %d", err, result.Status)
	}
	id := testenv.Decode[struct{ ID string }](t, result).ID
	path := f.root + "/quick-note-assets/" + id + "/content"
	f.env.Call(t, "GET", path, other.AccessToken, nil, 200)
	f.env.Call(t, "GET", path, f.owner.AccessToken, nil, 404)
	f.env.Call(t, "HEAD", path, f.owner.AccessToken, nil, 404)
	f.env.Call(t, "GET", f.root+"/assets/"+id+"/content", other.AccessToken, nil, 404)
	f.env.Call(t, "GET", f.root+"/assets/"+id, f.owner.AccessToken, nil, 404)
	collection := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", f.root+"/collections", f.owner.AccessToken, map[string]any{"title": "Shared documents"}, 201))
	doc := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", f.root+"/collections/"+collection.ID+"/documents", f.owner.AccessToken, map[string]any{"title": "Private asset isolation"}, 201))
	input := body("with private file")
	values := input["blocks"].([]document.Block)
	values = append(values, document.Block{ID: uuid.NewString(), Type: "file", Props: map[string]any{"source": map[string]any{"type": "asset", "asset_id": id}, "name": "thought.txt"}, Content: []document.TextRun{}, Children: []document.Block{}})
	input["blocks"] = values
	f.env.Call(t, "PUT", f.root+"/documents/"+doc.ID+"/content", other.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "title": "Private asset isolation", "blocks": values}, 404)
	f.env.Call(t, "POST", f.root+"/quick-notes", f.owner.AccessToken, input, 404)
	saved := testenv.Decode[note](t, f.env.Call(t, "POST", f.root+"/quick-notes", other.AccessToken, input, 201))
	f.env.Call(t, "GET", f.root+"/quick-notes/"+saved.ID, f.owner.AccessToken, nil, 404)
	otherWorkspace := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", "/api/v1/workspaces", other.AccessToken, map[string]any{"name": "Other workspace"}, 201))
	f.env.Call(t, "GET", "/api/v1/workspaces/"+otherWorkspace.ID+"/quick-notes/"+saved.ID, other.AccessToken, nil, 404)
	f.env.Call(t, "GET", "/api/v1/workspaces/"+otherWorkspace.ID+"/quick-note-assets/"+id+"/content", other.AccessToken, nil, 404)
	if err := f.env.DB.Exec("DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?", f.wid, other.User.ID).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "GET", path, other.AccessToken, nil, http.StatusNotFound)
	f.env.Call(t, "GET", f.root+"/quick-notes/"+saved.ID, other.AccessToken, nil, http.StatusNotFound)
}

func TestEngineFailureLeavesNoCapture(t *testing.T) {
	e := testenv.New(t)
	owner, wid := e.Owner(t)
	e.Call(t, "POST", "/api/v1/workspaces/"+wid+"/quick-notes", owner.AccessToken, body("retain this draft"), 503)
	var notes, receipts int64
	e.DB.Table("quick_notes").Count(&notes)
	e.DB.Table("quick_note_operations").Count(&receipts)
	if notes != 0 || receipts != 0 {
		t.Fatal("engine failure left a partial commit")
	}
}
