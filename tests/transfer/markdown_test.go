//go:build integration

package transfer_test

import (
	"bytes"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/markdown"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/tests/testenv"
)

type imported struct {
	Document struct {
		ID             string
		Title          string
		ContentVersion int64 `json:"content_version"`
		Position       int
		CreatedAtMS    int64 `json:"created_at_ms"`
		UpdatedAtMS    int64 `json:"updated_at_ms"`
	}
	Warnings []markdown.Warning
}
type fixture struct {
	env                         *testenv.Environment
	session                     testenv.Session
	wid, base, collection, path string
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	e := testenv.New(t)
	session, wid := e.Owner(t)
	base := "/api/v1/workspaces/" + wid
	c := testenv.Decode[struct{ ID string }](t, e.Call(
		t,
		"POST",
		base+"/collections",
		session.AccessToken,
		map[string]any{"title": "Imports"},
		201,
	))
	return fixture{
		env:        e,
		session:    session,
		wid:        wid,
		base:       base,
		collection: base + "/collections/" + c.ID,
		path:       base + "/collections/" + c.ID + "/imports/markdown",
	}
}
func (f fixture) version(t *testing.T) int64 {
	t.Helper()
	return testenv.Decode[struct {
		Version int64 `json:"directory_version"`
	}](t, f.env.Call(
		t,
		"GET",
		f.collection,
		f.session.AccessToken,
		nil,
		200,
	)).Version
}
func (f fixture) importDoc(t *testing.T, source string) imported {
	t.Helper()
	return testenv.Decode[imported](t, f.env.Call(
		t,
		"POST",
		f.path,
		f.session.AccessToken,
		integration.ImportInput{OperationID: uuid.NewString(), Title: "Imported", Markdown: source},
		201,
	))
}
func TestConcurrentMarkdownImportReplayAndAtomicRollback(t *testing.T) {
	f := newFixture(t)
	input := integration.ImportInput{OperationID: uuid.NewString(), Title: "导入.md", Markdown: "# 版本一\n\n**原文**"}
	results := make([]testenv.Result, 2)
	errors := make([]error, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results[i], errors[i] = f.env.Do("POST", f.path, f.session.AccessToken, input)
		}()
	}
	close(start)
	wg.Wait()
	for i := range results {
		if errors[i] != nil || results[i].Status != 201 {
			t.Fatalf("import %d: %+v %v", i, results[i], errors[i])
		}
	}
	a, b := testenv.Decode[imported](t, results[0]), testenv.Decode[imported](t, results[1])
	if a.Document.ID != b.Document.ID || a.Document.ContentVersion != 1 || f.version(t) != 2 {
		t.Fatal("retry duplicated initial document or directory mutation")
	}
	if a.Document.CreatedAtMS != a.Document.UpdatedAtMS || a.Document.CreatedAtMS == 0 || a.Warnings == nil {
		t.Fatal("invalid time or warnings contract")
	}
	input.Markdown = "changed"
	f.env.Call(
		t,
		"POST",
		f.path,
		f.session.AccessToken,
		input,
		409,
	)
	before := f.version(t)
	source := "![missing](" + f.base + "/assets/" + uuid.NewString() + "/content)"
	f.env.Call(
		t,
		"POST",
		f.path,
		f.session.AccessToken,
		integration.ImportInput{OperationID: uuid.NewString(), Title: "Invalid asset", Markdown: source},
		404,
	)
	if f.version(t) != before {
		t.Fatal("failed import changed directory")
	}
	var docs, receipts int64
	if err := f.env.DB.Table("documents").Count(&docs).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.env.DB.Table("document_imports").Count(&receipts).Error; err != nil {
		t.Fatal(err)
	}
	if docs != 1 || receipts != 1 {
		t.Fatalf("partial import leaked: %d %d", docs, receipts)
	}
}
func TestMarkdownExportHistoryAndArchiveAuthorization(t *testing.T) {
	f := newFixture(t)
	item := f.importDoc(t, "# 原始标题\n\n正文 **加粗**\n\n<script>alert(1)</script>")
	path := f.base + "/documents/" + item.Document.ID
	if len(item.Warnings) != 1 || item.Warnings[0].Code != "RAW_HTML_AS_TEXT" {
		t.Fatal("missing raw HTML warning")
	}
	f.env.Call(
		t,
		"PUT",
		path+"/content",
		f.session.AccessToken,
		map[string]any{
			"operation_id":     uuid.NewString(),
			"expected_version": 1,
			"title":            "Edited",
			"blocks":           []document.Block{{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "second"}}}},
		},
		200,
	)
	get := f.env.Call(
		t,
		"GET",
		path+"/export/markdown?version=1",
		f.session.AccessToken,
		nil,
		200,
	)
	head := f.env.Call(
		t,
		"HEAD",
		path+"/export/markdown?version=1",
		f.session.AccessToken,
		nil,
		200,
	)
	if string(get.Body) == "" || strings.Contains(string(get.Body), "<script>") || !strings.Contains(string(get.Body), "原始标题") || strings.Contains(string(get.Body), "second") {
		t.Fatalf("invalid historical export %s", get.Body)
	}
	if get.Header.Get("X-Document-Version") != "1" || get.Header.Get("Content-Length") != head.Header.Get("Content-Length") || len(head.Body) != 0 || !strings.HasPrefix(get.Header.Get("Content-Disposition"), "attachment;") {
		t.Fatal("invalid attachment headers")
	}
	outsider := f.env.AddUser(t, "outsider@example.test")
	f.env.Call(
		t,
		"GET",
		path+"/export/markdown",
		outsider.AccessToken,
		nil,
		404,
	)
	f.env.Call(
		t,
		"GET",
		path+"/export/markdown?version=0",
		f.session.AccessToken,
		nil,
		422,
	)
	f.env.Call(
		t,
		"GET",
		path+"/export/markdown?version=99",
		f.session.AccessToken,
		nil,
		404,
	)
	f.env.Call(
		t,
		"PUT",
		path+"/archive",
		f.session.AccessToken,
		map[string]any{"expected_directory_version": f.version(t), "archived": true},
		200,
	)
	f.env.Call(
		t,
		"GET",
		path+"/export/markdown?version=1",
		f.session.AccessToken,
		nil,
		404,
	)
	f.env.Call(
		t,
		"HEAD",
		path+"/export/markdown",
		f.session.AccessToken,
		nil,
		404,
	)
}
func TestMarkdownImportLimitsParentVisibilityAndNoRemoteFetch(t *testing.T) {
	f := newFixture(t)
	var calls atomic.Int64
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(500) }))
	defer remote.Close()
	item := f.importDoc(t, "![image]("+remote.URL+"/image.png)")
	if calls.Load() != 0 {
		t.Fatal("import fetched external URL")
	}
	parent := item.Document.ID
	f.env.Call(
		t,
		"PUT",
		f.base+"/documents/"+parent+"/archive",
		f.session.AccessToken,
		map[string]any{"expected_directory_version": f.version(t), "archived": true},
		200,
	)
	f.env.Call(
		t,
		"POST",
		f.path,
		f.session.AccessToken,
		integration.ImportInput{OperationID: uuid.NewString(), Title: "child", ParentID: &parent, Markdown: "text"},
		404,
	)
	for _, value := range []any{nil, 123} {
		f.env.Call(
			t,
			"POST",
			f.path,
			f.session.AccessToken,
			map[string]any{"operation_id": uuid.NewString(), "title": "Bad", "markdown": value},
			422,
		)
	}
	f.env.Call(
		t,
		"POST",
		f.path,
		f.session.AccessToken,
		integration.ImportInput{OperationID: uuid.NewString(), Title: "large", Markdown: strings.Repeat("a", markdown.MaxImportBytes+1)},
		413,
	)
	empty := f.importDoc(t, "")
	if empty.Document.ContentVersion != 1 {
		t.Fatal("empty import failed")
	}
}

func TestMarkdownImportViewerAndPrivateImageReferences(t *testing.T) {
	f := newFixture(t)
	viewer := f.env.AddUser(t, "viewer@example.test")
	now := f.env.Clock.Now().UnixMilli()
	if err := f.env.DB.Exec(
		"INSERT INTO workspace_members(workspace_id,user_id,role,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?)",
		f.wid,
		viewer.User.ID,
		"viewer",
		now,
		now,
	).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(
		t,
		"POST",
		f.path,
		viewer.AccessToken,
		integration.ImportInput{OperationID: uuid.NewString(), Title: "Denied", Markdown: "x"},
		403,
	)
	var upload bytes.Buffer
	form := multipart.NewWriter(&upload)
	part, err := form.CreateFormFile("file", "tiny.png")
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(part, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", f.base+"/assets", &upload)
	request.Header.Set("Content-Type", form.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+f.session.AccessToken)
	response, err := f.env.DoRequest(request)
	if err != nil || response.Status != 201 {
		t.Fatalf("upload failed: %+v %v", response, err)
	}
	asset := testenv.Decode[struct{ ID string }](t, response)
	source := "![私有图片](" + f.base + "/assets/" + asset.ID + "/content)"
	imported := f.importDoc(t, source)
	path := f.base + "/documents/" + imported.Document.ID
	content := testenv.Decode[struct{ Blocks []document.Block }](t, f.env.Call(
		t,
		"GET",
		path+"/content",
		viewer.AccessToken,
		nil,
		200,
	))
	if len(content.Blocks) != 1 || content.Blocks[0].Props["source"].(map[string]any)["asset_id"] != asset.ID {
		t.Fatal("private image reference was not preserved")
	}
	out := f.env.Call(
		t,
		"GET",
		path+"/export/markdown",
		viewer.AccessToken,
		nil,
		200,
	)
	if !strings.Contains(string(out.Body), "/assets/"+asset.ID+"/content") {
		t.Fatal("asset export lost authenticated content path")
	}
	f.env.Call(
		t,
		"GET",
		f.base+"/assets/"+asset.ID+"/content",
		"",
		nil,
		401,
	)
}
