package command

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"orbis.local/orbis/cli/internal/client"
)

const wid = "b2f97637-0128-49f1-be82-f33ba1aedafc"
const oid = "e46d6eaf-c1de-4b99-8977-ce5e01ad9d1d"

type memoryStore struct {
	token       string
	unavailable bool
	sets        int
}

func (s *memoryStore) Get(string, string) (string, error) {
	if s.unavailable {
		return "", errors.New("unavailable")
	}
	return s.token, nil
}
func (s *memoryStore) Set(_, _, token string) error {
	if s.unavailable {
		return errors.New("unavailable")
	}
	s.token = token
	s.sets++
	return nil
}
func (s *memoryStore) Delete(string, string) error { s.token = ""; return nil }
func runtimeFor(t *testing.T, base string) (Runtime, *bytes.Buffer, map[string]string, *memoryStore) {
	t.Helper()
	out := &bytes.Buffer{}
	env := map[string]string{"ORBIS_CONFIG_DIR": t.TempDir(), "ORBIS_BASE_URL": base, "ORBIS_WORKSPACE_ID": wid, "ORBIS_TOKEN": "orbis_it_synthetic"}
	store := &memoryStore{}
	return Runtime{In: strings.NewReader(""), Out: out, Err: out, Getenv: func(k string) string { return env[k] }, Store: store}, out, env, store
}
func run(t *testing.T, r Runtime, out *bytes.Buffer, exit int, args ...string) client.Envelope {
	t.Helper()
	out.Reset()
	got := r.Run(t.Context(), append([]string{"--json"}, args...))
	if got != exit {
		t.Fatalf("%v: exit %d want %d: %s", args, got, exit, out.String())
	}
	var env client.Envelope
	if err := json.Unmarshal(out.Bytes(), &env); err != nil {
		t.Fatalf("not one envelope: %s", out.String())
	}
	return env
}
func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(client.Envelope{Code: "OK", Message: "成功", RequestID: "request", Data: data})
}
func write(t *testing.T, name string, b []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, b, 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
func TestDoctorAndArgumentsAlwaysEmitOneSafeEnvelope(t *testing.T) {
	r, out, env, _ := runtimeFor(t, "")
	delete(env, "ORBIS_TOKEN")
	got := run(t, r, out, 2, "doctor")
	if got.Code != "CLI_DOCTOR_FAILED" || client.Object(got.Data)["token_source"] != "missing" {
		t.Fatal(got)
	}
	for _, args := range [][]string{{"notes", "list", "--limit", "1000"}, {"doctor", "--token", "orbis_it_accidental"}, {"imports", "finalize", oid, "--wait-seconds", "nan"}, {"documents", "resolve", "--id", oid, "--title", "two"}} {
		got := run(t, r, out, 2, args...)
		if strings.Contains(out.String(), "orbis_it_accidental") {
			t.Fatal("secret argument leaked")
		}
		if got.Code == "" {
			t.Fatal("missing code")
		}
	}
}
func TestAliasesPagingAndSameInstanceResolve(t *testing.T) {
	var requests []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		requests = append(requests, req.Method+" "+req.URL.RequestURI())
		respond(w, 200, map[string]any{"items": []any{}})
	}))
	defer server.Close()
	r, out, _, _ := runtimeFor(t, server.URL)
	run(t, r, out, 0, "notebooks", "list", "--allow-http", "--limit", "5", "--page", "2")
	run(t, r, out, 0, "notes", "list", "--allow-http", "--notebook", oid)
	run(t, r, out, 0, "blocks", "list", "--allow-http", "--note", oid, "--cursor", "opaque:next", "--version", "3")
	run(t, r, out, 0, "documents", "resolve", "--allow-http", "--url", server.URL+"/documents/"+oid)
	got := run(t, r, out, 2, "documents", "resolve", "--allow-http", "--url", "https://foreign.example/documents/"+oid)
	if got.Code != "CLI_FOREIGN_INSTANCE" || len(requests) != 4 || !strings.Contains(requests[0], "page=2&page_size=5") || !strings.Contains(requests[2], "cursor=opaque%3Anext") || strings.Contains(requests[2], "page=") {
		t.Fatalf("unexpected paths: %v %+v", requests, got)
	}
}
func TestLoginUsesStdinAndKeyringNeverProfileToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer orbis_it_from_stdin" {
			t.Error("wrong credential")
		}
		respond(w, 200, map[string]any{"id": "synthetic"})
	}))
	defer server.Close()
	r, out, env, store := runtimeFor(t, server.URL)
	r.In = strings.NewReader("orbis_it_from_stdin\n")
	run(t, r, out, 0, "auth", "login", "--token-stdin", "--allow-http")
	if store.token != "orbis_it_from_stdin" || store.sets != 1 {
		t.Fatal("token not in keyring")
	}
	content, err := os.ReadFile(filepath.Join(env["ORBIS_CONFIG_DIR"], "config.json"))
	if err != nil || bytes.Contains(content, []byte("orbis_it_")) {
		t.Fatal("secret persisted")
	}
	store.unavailable = true
	r.In = strings.NewReader("orbis_it_from_stdin")
	got := run(t, r, out, 3, "auth", "login", "--token-stdin", "--allow-http")
	if got.Code != "CLI_CREDENTIAL_STORE_UNAVAILABLE" {
		t.Fatal(got)
	}
}
func TestDryRunCreateDoesNotCallServer(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++ }))
	defer server.Close()
	r, out, _, _ := runtimeFor(t, server.URL)
	r.In = strings.NewReader("# stdin markdown")
	got := run(t, r, out, 0, "documents", "import", "--allow-http", "--collection", wid, "--title", "新文档", "--operation-id", oid, "--file", "-", "--dry-run")
	if calls != 0 || client.Object(client.Object(got.Data)["request"])["markdown"] != "# stdin markdown" {
		t.Fatalf("dryrun submitted: %v", got)
	}
}
func TestDownloadRejectsDigestMismatchWithoutReplacingOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/content") {
			_, _ = w.Write([]byte("bad"))
			return
		}
		respond(w, 200, map[string]any{"size_bytes": 3, "sha256": "notmatching"})
	}))
	defer server.Close()
	r, out, _, _ := runtimeFor(t, server.URL)
	target := write(t, "keep.txt", []byte("old"))
	got := run(t, r, out, 7, "files", "download", oid, "--allow-http", "--document", wid, "--out", target)
	b, _ := os.ReadFile(target)
	if got.Code != "CLI_DOWNLOAD_DIGEST_MISMATCH" || string(b) != "old" {
		t.Fatal("unverified bytes replaced output")
	}
}
func TestUploadUsesDigestAndOriginalOperationAndBinaryPart(t *testing.T) {
	content := []byte("private\x00bytes")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("operation_id") != oid || r.URL.Query().Get("sha256") != sha256hex(content) {
			t.Error("missing upload intent")
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			t.Error(err)
			return
		}
		defer file.Close()
		actual, _ := io.ReadAll(file)
		if !bytes.Equal(actual, content) || header.Filename != "file.bin" {
			t.Error("multipart changed content")
		}
		respond(w, 201, map[string]any{"id": oid})
	}))
	defer server.Close()
	r, out, _, _ := runtimeFor(t, server.URL)
	run(t, r, out, 0, "files", "upload", "--allow-http", "--document", wid, "--file", write(t, "file.bin", content), "--operation-id", oid)
}
func TestObservingActiveImportNeverFinalizesAgain(t *testing.T) {
	for _, state := range []string{"queued", "processing"} {
		t.Run(state, func(t *testing.T) {
			posts := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "POST" {
					posts++
				}
				respond(w, 200, map[string]any{"id": oid, "state": state})
			}))
			defer server.Close()
			r, out, _, _ := runtimeFor(t, server.URL)
			got := run(t, r, out, 6, "imports", "finalize", oid, "--allow-http", "--wait-seconds", "0")
			if got.Code != "CLI_IMPORT_PENDING" || posts != 0 || client.Object(got.Data)["id"] != oid {
				t.Fatal("active job was restarted")
			}
		})
	}
}
func TestStagedImportResumesConfirmedPartialChunkAndOriginalIntent(t *testing.T) {
	content := []byte("# Header\n\n" + strings.Repeat("Readable Markdown paragraph.\n\n", 24000))
	confirmed := int64(12345)
	offset := confirmed
	chunk := int64(256 * 1024)
	var mu sync.Mutex
	posts := 0
	puts := 0
	state := "uploading"
	digest := sha256.Sum256(content)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch {
		case strings.HasSuffix(r.URL.Path, "/capabilities"):
			respond(w, 200, map[string]any{"features": map[string]any{"large_markdown_import": true}, "limits": map[string]any{"import_bytes": maxImportBytes}})
			return
		case r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/imports"):
			posts++
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["operation_id"] != wid || body["sha256"] != hex.EncodeToString(digest[:]) {
				t.Error("changed source intent")
			}
		case r.Method == "PUT":
			puts++
			var requested int64
			_, _ = fmt.Sscan(r.URL.Query().Get("offset"), &requested)
			b, _ := io.ReadAll(r.Body)
			if requested != offset || !bytes.Equal(b, content[offset:offset+int64(len(b))]) || r.Header.Get("X-Chunk-SHA256") != sha256hex(b) {
				t.Error("incorrect resumed content")
			}
			offset += int64(len(b))
			if puts == 1 {
				connection, _, err := w.(http.Hijacker).Hijack()
				if err == nil {
					_ = connection.Close()
				}
				return
			}
		case strings.HasSuffix(r.URL.Path, "/finalize"):
			state = "completed"
		}
		respond(w, 200, map[string]any{"id": oid, "operation_id": wid, "state": state, "received_bytes": offset, "size_bytes": len(content), "chunk_bytes": chunk, "result": map[string]any{"document_id": wid}})
	}))
	defer server.Close()
	r, out, _, _ := runtimeFor(t, server.URL)
	got := run(t, r, out, 0, "documents", "import", "--allow-http", "--collection", wid, "--title", "Large", "--operation-id", wid, "--file", write(t, "large.md", content), "--wait-seconds", "0")
	if posts != 1 || puts != 3 || offset != int64(len(content)) || client.Object(got.Data)["document_id"] != wid {
		t.Fatalf("resume failed: posts %d puts %d offset %d got %v", posts, puts, offset, got)
	}
}
func TestLostFinalizeResponseOnlyObservesOriginalImport(t *testing.T) {
	posts := 0
	active := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			posts++
			active = true
			conn, _, _ := w.(http.Hijacker).Hijack()
			_ = conn.Close()
			return
		}
		state := "uploading"
		if active {
			state = "processing"
		}
		respond(w, 200, map[string]any{"id": oid, "operation_id": wid, "state": state})
	}))
	defer server.Close()
	r, out, _, _ := runtimeFor(t, server.URL)
	got := run(t, r, out, 6, "imports", "finalize", oid, "--allow-http", "--wait-seconds", "0")
	if posts != 1 || client.Object(got.Data)["state"] != "processing" {
		t.Fatal("finalize restarted live job")
	}
}

func TestStagedDryRunEnforcesBudgetWithoutNetwork(t *testing.T) {
	r, out, _, _ := runtimeFor(t, "https://orbis.example")
	path := filepath.Join(t.TempDir(), "over-limit.md")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = f.Truncate(maxImportBytes + 1); err != nil {
		t.Fatal(err)
	}
	if err = f.Close(); err != nil {
		t.Fatal(err)
	}
	got := run(t, r, out, 2, "documents", "import", "--collection", wid, "--title", "too large", "--operation-id", oid, "--file", path, "--dry-run")
	if got.Code != "CLI_IMPORT_BUDGET_EXCEEDED" {
		t.Fatalf("wrong budget result: %v", got)
	}
}

func TestChangedSourceAfterUploadIsNotFinalized(t *testing.T) {
	content := []byte(strings.Repeat("Readable paragraph\n\n", 30000))
	path := write(t, "source.md", content)
	offset := int64(0)
	finalized := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/capabilities"):
			respond(w, 200, map[string]any{"features": map[string]any{"large_markdown_import": true}})
			return
		case r.Method == "PUT":
			b, _ := io.ReadAll(r.Body)
			offset += int64(len(b))
			if offset == int64(len(content)) {
				if err := os.WriteFile(path, bytes.Repeat([]byte("X"), len(content)), 0600); err != nil {
					t.Error(err)
				}
			}
		case strings.HasSuffix(r.URL.Path, "/finalize"):
			finalized = true
		}
		respond(w, 200, map[string]any{"id": oid, "operation_id": wid, "state": "uploading", "received_bytes": offset, "size_bytes": len(content), "chunk_bytes": 256 * 1024})
	}))
	defer server.Close()
	r, out, _, _ := runtimeFor(t, server.URL)
	got := run(t, r, out, 2, "documents", "import", "--allow-http", "--collection", wid, "--title", "changed", "--operation-id", wid, "--file", path, "--wait-seconds", "0")
	if got.Code != "CLI_SOURCE_CHANGED" || finalized {
		t.Fatal("changed source was finalized")
	}
}

func TestJSONInputBudgetAndNonObjectAreRejectedLocally(t *testing.T) {
	r, out, _, _ := runtimeFor(t, "https://orbis.example")
	for _, tc := range []struct {
		data []byte
		code string
	}{{[]byte(`[]`), "CLI_INPUT_INVALID"}, {[]byte(`{} {}`), "CLI_INPUT_INVALID"}, {bytes.Repeat([]byte(" "), maxInputBytes+1), "CLI_INPUT_BUDGET_EXCEEDED"}} {
		got := run(t, r, out, 2, "operations", "apply", "--document", wid, "--file", write(t, "request.json", tc.data))
		if got.Code != tc.code {
			t.Fatalf("got %v", got)
		}
	}
}

func TestUnusableUploadResponseRecoversOriginalOperation(t *testing.T) {
	posts := 0
	observations := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			posts++
			w.WriteHeader(201)
			_, _ = w.Write([]byte("<html>response replaced</html>"))
			return
		}
		observations++
		if !strings.HasSuffix(r.URL.Path, "/operations/"+oid) {
			t.Error("incorrect recovery scope")
		}
		respond(w, 200, map[string]any{"state": "completed", "result": map[string]any{"id": wid}})
	}))
	defer server.Close()
	r, out, _, _ := runtimeFor(t, server.URL)
	got := run(t, r, out, 0, "files", "upload", "--allow-http", "--document", wid, "--file", write(t, "file.txt", []byte("attachment")), "--operation-id", oid)
	if posts != 1 || observations != 1 || client.Object(got.Data)["id"] != wid {
		t.Fatal("upload did not recover committed result")
	}
}

func TestUnusableImportResponsesPreserveSessionAndProgress(t *testing.T) {
	for _, phase := range []string{"create", "chunk", "finalize"} {
		t.Run(phase, func(t *testing.T) {
			content := []byte(strings.Repeat("Readable Markdown\n\n", 32000))
			offset := 0
			state := "uploading"
			corrupted := false
			creates := 0
			finalizations := 0
			var createIntent []byte
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				current := ""
				switch {
				case strings.HasSuffix(r.URL.Path, "/capabilities"):
					respond(w, 200, map[string]any{"features": map[string]any{"large_markdown_import": true}})
					return
				case r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/imports"):
					current = "create"
					creates++
					body, _ := io.ReadAll(r.Body)
					if creates == 1 {
						createIntent = body
					} else if !bytes.Equal(createIntent, body) {
						t.Error("retry changed import intent")
					}
				case r.Method == "PUT":
					current = "chunk"
					b, _ := io.ReadAll(r.Body)
					var requested int
					_, _ = fmt.Sscan(r.URL.Query().Get("offset"), &requested)
					if requested != offset || !bytes.Equal(content[offset:offset+len(b)], b) {
						t.Error("retry retransmitted committed bytes")
					}
					offset += len(b)
				case strings.HasSuffix(r.URL.Path, "/finalize"):
					current = "finalize"
					state = "completed"
					finalizations++
				}
				if current == phase && !corrupted {
					corrupted = true
					w.WriteHeader(200)
					_, _ = w.Write([]byte("<html>unusable write response</html>"))
					return
				}
				respond(w, 200, map[string]any{"id": oid, "operation_id": wid, "state": state, "size_bytes": len(content), "received_bytes": offset, "chunk_bytes": 256 * 1024, "result": map[string]any{"document_id": wid}})
			}))
			defer server.Close()
			r, out, _, _ := runtimeFor(t, server.URL)
			got := run(t, r, out, 0, "documents", "import", "--allow-http", "--collection", wid, "--title", "recover", "--operation-id", wid, "--file", write(t, "large.md", content), "--wait-seconds", "0")
			wantCreates := 1
			if phase == "create" {
				wantCreates = 2
			}
			if !corrupted || creates != wantCreates || finalizations != 1 || offset != len(content) || client.Object(got.Data)["import_id"] != oid {
				t.Fatalf("recovery changed identity/progress: %s creates%d finalized%d offset%d result%v", phase, creates, finalizations, offset, got)
			}
		})
	}
}

func TestImportUncertaintySurvivesPermissionChangeOnRetry(t *testing.T) {
	for _, phase := range []string{"create", "chunk"} {
		t.Run(phase, func(t *testing.T) {
			content := []byte(strings.Repeat("Readable Markdown\n\n", 32000))
			attempts := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/capabilities") {
					respond(w, 200, map[string]any{"features": map[string]any{"large_markdown_import": true}})
					return
				}
				target := (phase == "create" && r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/imports")) || (phase == "chunk" && r.Method == "PUT")
				if target {
					attempts++
					if attempts == 1 {
						w.WriteHeader(200)
						_, _ = w.Write([]byte("<html>unusable response</html>"))
						return
					}
					w.WriteHeader(403)
					_ = json.NewEncoder(w).Encode(client.Envelope{Code: "FORBIDDEN", Message: "权限已撤销"})
					return
				}
				respond(w, 200, map[string]any{"id": oid, "operation_id": wid, "state": "uploading", "size_bytes": len(content), "received_bytes": 0, "chunk_bytes": 256 * 1024})
			}))
			defer server.Close()
			r, out, _, _ := runtimeFor(t, server.URL)
			got := run(t, r, out, 6, "documents", "import", "--allow-http", "--collection", wid, "--title", "recover", "--operation-id", wid, "--file", write(t, "large.md", content), "--wait-seconds", "0")
			data := client.Object(got.Data)
			if attempts != 2 || (phase == "create" && (got.Code != "CLI_NETWORK_ERROR" || data["operation_id"] != wid)) || (phase == "chunk" && (got.Code != "CLI_IMPORT_PENDING" || data["id"] != oid)) {
				t.Fatalf("unknown write became a definitive rejection: %s %+v", phase, got)
			}
		})
	}
}
