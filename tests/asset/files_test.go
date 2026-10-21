//go:build integration

package asset_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime"
	"mime/multipart"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	assetstore "orbis.local/orbis/internal/asset/postgres"
	"orbis.local/orbis/internal/platform/storage"
	"orbis.local/orbis/tests/testenv"
)

type fileInfo struct {
	ID, Filename string
	OwnerID      string `json:"owner_id"`
	MediaType    string `json:"media_type"`
	SizeBytes    int64  `json:"size_bytes"`
	SHA256       string `json:"sha256"`
}

func upload(env *testenv.Environment, method, path, token, filename, media string, data []byte) (testenv.Result, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	headers := make(textproto.MIMEHeader)
	headers.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "file", "filename": filename}))
	headers.Set("Content-Type", media)
	part, err := writer.CreatePart(headers)
	if err != nil {
		return testenv.Result{}, err
	}
	if _, err := part.Write(data); err != nil {
		return testenv.Result{}, err
	}
	if err := writer.Close(); err != nil {
		return testenv.Result{}, err
	}
	request := httptest.NewRequest(method, path, &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+token)
	return env.DoRequest(request)
}
func requireResult(t *testing.T, result testenv.Result, err error, status int) testenv.Result {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != status {
		t.Fatalf("status=%d code=%s, want %d", result.Status, result.Code, status)
	}
	if result.RequestID == "" || result.Header.Get("X-Request-ID") != result.RequestID {
		t.Fatal("request ID is inconsistent")
	}
	return result
}
func putFile(t *testing.T, env *testenv.Environment, root, token, name, media string, data []byte) fileInfo {
	t.Helper()
	result, err := upload(
		env,
		"POST",
		root,
		token,
		name,
		media,
		data,
	)
	return testenv.Decode[fileInfo](t, requireResult(t, result, err, 201))
}
func download(t *testing.T, env *testenv.Environment, method, path, token string, headers map[string]string, status int) testenv.Result {
	t.Helper()
	request := httptest.NewRequest(method, path, nil)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	result, err := env.DoRequest(request)
	return requireResult(t, result, err, status)
}
func imageBytes(t *testing.T) []byte {
	t.Helper()
	src := image.NewNRGBA(image.Rect(0, 0, 128, 64))
	for y := range 64 {
		for x := range 128 {
			src.SetNRGBA(x, y, color.NRGBA{R: 20, G: 100, B: 150, A: 255})
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, src); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}
func addMember(t *testing.T, env *testenv.Environment, wid, email, role string) testenv.Session {
	t.Helper()
	user := env.AddUser(t, email)
	now := env.Clock.Now().UnixMilli()
	if err := env.DB.Exec(
		"INSERT INTO workspace_members (workspace_id,user_id,role,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?)",
		wid,
		user.User.ID,
		role,
		now,
		now,
	).Error; err != nil {
		t.Fatal(err)
	}
	return user
}
func cleanup(t *testing.T, env *testenv.Environment) int {
	t.Helper()
	store, err := storage.NewLocal(env.StorageDir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	count, err := assetstore.New(env.DB, env.Clock).Cleanup(t.Context(), store.Remove)
	if err != nil {
		t.Fatal(err)
	}
	return count
}

func TestFileDeliveryRangesAndPermissions(t *testing.T) {
	env := testenv.New(t)
	owner, wid := env.Owner(t)
	root := "/api/v1/workspaces/" + wid + "/assets"
	file := putFile(
		t,
		env,
		root,
		owner.AccessToken,
		"使用说明.txt",
		"text/plain",
		[]byte("0123456789"),
	)
	sum := sha256.Sum256([]byte("0123456789"))
	if file.SizeBytes != 10 || file.SHA256 != hex.EncodeToString(sum[:]) || file.MediaType != "text/plain" {
		t.Fatal("uploaded metadata is incorrect")
	}
	meta := env.Call(
		t,
		"GET",
		root+"/"+file.ID,
		owner.AccessToken,
		nil,
		200,
	)
	if bytes.Contains(meta.Data, []byte("storage_key")) {
		t.Fatal("storage key is exposed")
	}
	path := root + "/" + file.ID + "/content"
	initial := download(
		t,
		env,
		"GET",
		path,
		owner.AccessToken,
		nil,
		200,
	)
	if string(initial.Body) != "0123456789" || !strings.HasPrefix(initial.Header.Get("Content-Disposition"), "attachment;") || !strings.Contains(initial.Header.Get("Content-Disposition"), "filename*=utf-8''") {
		t.Fatal("download bytes or filename encoding are incorrect")
	}
	if initial.Header.Get("Content-Security-Policy") != "default-src 'none'; sandbox; frame-ancestors 'none'" || initial.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("delivery protections are missing")
	}
	partial := download(
		t,
		env,
		"GET",
		path,
		owner.AccessToken,
		map[string]string{"Range": "bytes=2-5"},
		206,
	)
	if string(partial.Body) != "2345" || partial.Header.Get("Content-Range") != "bytes 2-5/10" {
		t.Fatal("partial range is incorrect")
	}
	suffix := download(
		t,
		env,
		"GET",
		path,
		owner.AccessToken,
		map[string]string{"Range": "bytes=-3"},
		206,
	)
	if string(suffix.Body) != "789" {
		t.Fatal("suffix range is incorrect")
	}
	multi := download(
		t,
		env,
		"GET",
		path,
		owner.AccessToken,
		map[string]string{"Range": "bytes=0-1,8-9"},
		206,
	)
	_, params, err := mime.ParseMediaType(multi.Header.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	reader := multipart.NewReader(bytes.NewReader(multi.Body), params["boundary"])
	for _, want := range []string{"01", "89"} {
		part, err := reader.NextPart()
		if err != nil {
			t.Fatal(err)
		}
		actual, err := io.ReadAll(part)
		if err != nil || string(actual) != want {
			t.Fatal("multipart range is incorrect")
		}
	}
	invalid := download(
		t,
		env,
		"GET",
		path,
		owner.AccessToken,
		map[string]string{"Range": "items=0-2"},
		400,
	)
	if invalid.Code != "INVALID_RANGE" {
		t.Fatal("invalid range code differs")
	}
	unsatisfied := download(
		t,
		env,
		"GET",
		path,
		owner.AccessToken,
		map[string]string{"Range": "bytes=999-1000"},
		416,
	)
	if unsatisfied.Code != "RANGE_NOT_SATISFIABLE" || unsatisfied.Header.Get("Content-Range") != "bytes */10" {
		t.Fatal("unsatisfiable range contract differs")
	}
	download(
		t,
		env,
		"GET",
		path,
		owner.AccessToken,
		map[string]string{"Range": "items=0-2", "If-Range": "\"stale\""},
		200,
	)
	download(
		t,
		env,
		"GET",
		path,
		owner.AccessToken,
		map[string]string{"Range": "bytes=2-5", "If-Range": initial.Header.Get("ETag")},
		206,
	)
	download(
		t,
		env,
		"GET",
		path,
		owner.AccessToken,
		map[string]string{"If-None-Match": initial.Header.Get("ETag"), "Range": "items=0-2"},
		304,
	)
	download(
		t,
		env,
		"GET",
		path,
		owner.AccessToken,
		map[string]string{"If-Match": "\"stale\""},
		412,
	)
	head := download(
		t,
		env,
		"HEAD",
		path,
		owner.AccessToken,
		nil,
		200,
	)
	if head.Header.Get("Content-Length") != "10" {
		t.Fatal("HEAD lost the object length")
	}
	download(
		t,
		env,
		"HEAD",
		path,
		"",
		nil,
		401,
	)
	download(
		t,
		env,
		"GET",
		path,
		"",
		nil,
		401,
	)
	viewer := addMember(t, env, wid, "viewer@example.test", "viewer")
	download(
		t,
		env,
		"GET",
		path,
		viewer.AccessToken,
		nil,
		200,
	)
	own := testenv.Decode[struct{ Items []fileInfo }](t, env.Call(
		t,
		"GET",
		root,
		viewer.AccessToken,
		nil,
		200,
	))
	if len(own.Items) != 0 {
		t.Fatal("file listing did not stay scoped to uploader")
	}
	result, err := upload(
		env,
		"POST",
		root,
		viewer.AccessToken,
		"no.txt",
		"text/plain",
		[]byte("no"),
	)
	requireResult(t, result, err, 403)
	outsider := env.AddUser(t, "outsider@example.test")
	download(
		t,
		env,
		"GET",
		path,
		outsider.AccessToken,
		nil,
		404,
	)
	other := testenv.Decode[struct{ ID string }](t, env.Call(
		t,
		"POST",
		"/api/v1/workspaces",
		owner.AccessToken,
		map[string]any{"name": "Other"},
		201,
	))
	download(
		t,
		env,
		"GET",
		"/api/v1/workspaces/"+other.ID+"/assets/"+file.ID+"/content",
		owner.AccessToken,
		nil,
		404,
	)
}

func TestFileSniffingLimitsAndMissingObjects(t *testing.T) {
	env := testenv.NewWithUploadLimit(t, 32)
	owner, wid := env.Owner(t)
	root := "/api/v1/workspaces/" + wid + "/assets"
	html := putFile(
		t,
		env,
		root,
		owner.AccessToken,
		"../页面.html",
		"image/png",
		[]byte("<script>alert(1)</script>"),
	)
	result := download(
		t,
		env,
		"GET",
		root+"/"+html.ID+"/content",
		owner.AccessToken,
		nil,
		200,
	)
	if html.Filename != "页面.html" || result.Header.Get("Content-Type") != "application/octet-stream" || !strings.HasPrefix(result.Header.Get("Content-Disposition"), "attachment;") {
		t.Fatal("client MIME hint was trusted for active content")
	}
	response, err := upload(
		env,
		"POST",
		root,
		owner.AccessToken,
		"large.txt",
		"text/plain",
		bytes.Repeat([]byte("x"), 33),
	)
	requireResult(t, response, err, 413)
	var ready int64
	if err := env.DB.Table("assets").Where("state='ready'").Count(&ready).Error; err != nil {
		t.Fatal(err)
	}
	if ready != 1 {
		t.Fatal("oversized upload became visible")
	}
	files, err := os.ReadDir(env.StorageDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 {
		t.Fatal("oversized upload left partial bytes")
	}
	empty := putFile(
		t,
		env,
		root,
		owner.AccessToken,
		"empty.txt",
		"text/plain",
		nil,
	)
	download(
		t,
		env,
		"GET",
		root+"/"+empty.ID+"/content",
		owner.AccessToken,
		nil,
		200,
	)
	if err := os.Remove(filepath.Join(env.StorageDir, html.ID+".blob")); err != nil {
		t.Fatal(err)
	}
	download(
		t,
		env,
		"GET",
		root+"/"+html.ID+"/content",
		owner.AccessToken,
		nil,
		404,
	)
	env.Clock.Advance(time.Hour + time.Millisecond)
	if cleanup(t, env) != 1 {
		t.Fatal("expired failed upload was not cleaned")
	}
	if cleanup(t, env) != 0 {
		t.Fatal("cleanup was not idempotent")
	}
	var state string
	if err := env.DB.Table("assets").Select("state").Where("id=?", empty.ID).Scan(&state).Error; err != nil {
		t.Fatal(err)
	}
	if state != "ready" {
		t.Fatal("cleanup retired a ready file")
	}
}

func TestFileRejectsAdditionalMultipartFields(t *testing.T) {
	env := testenv.New(t)
	owner, wid := env.Owner(t)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	first, err := writer.CreateFormFile("file", "first.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = first.Write([]byte("first"))
	if err := writer.WriteField("unexpected", "field"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/api/v1/workspaces/"+wid+"/assets", &body)
	request.Header.Set("Authorization", "Bearer "+owner.AccessToken)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	result, err := env.DoRequest(request)
	requireResult(t, result, err, 422)
	files, err := os.ReadDir(env.StorageDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Fatal("invalid multipart upload left content")
	}
}
