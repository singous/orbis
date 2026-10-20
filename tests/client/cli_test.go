//go:build integration

package client_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/tests/testenv"
)

type cli struct {
	t                                        *testing.T
	directory, workspace, token, url, binary string
	stdin                                    []byte
}

func cliFixture(t *testing.T, queue bool) (*cli, *testenv.Environment, *atomic.Bool, string) {
	t.Helper()
	return cliFixtureWithEnvironment(t, queue, testenv.New(t))
}
func cliFixtureWithEnvironment(t *testing.T, queue bool, env *testenv.Environment) (*cli, *testenv.Environment, *atomic.Bool, string) {
	t.Helper()
	if queue {
		env.EnableQueue(t)
	}
	owner, wid := env.Owner(t)
	base := "/api/v1/workspaces/" + wid
	collection := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/collections", owner.AccessToken, map[string]any{"title": "CLI collection"}, 201))
	token := testenv.Decode[struct{ Token string }](t, env.Call(t, "POST", base+"/integration-tokens", owner.AccessToken, integration.TokenInput{Name: "CLI journey", CollectionID: &collection.ID, Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite, integration.AssetsRead, integration.AssetsWrite, integration.SharesManage}}, 201))
	lost := &atomic.Bool{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/operations") && lost.CompareAndSwap(true, false) {
			recorder := httptest.NewRecorder()
			env.Handler.ServeHTTP(recorder, r)
			if recorder.Code != 200 {
				t.Error("synthetic lost response did not commit")
			}
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<html>The proxy replaced the committed response.</html>"))
			return
		}
		env.Handler.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	source, err := filepath.Abs("../../cli")
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	binary := filepath.Join(directory, "orbis")
	ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
	defer cancel()
	build := exec.CommandContext(ctx, filepath.Join(runtime.GOROOT(), "bin", "go"), "-C", source, "build", "-o", binary, "./cmd/orbis")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build standalone Go CLI: %v %s", err, output)
	}
	return &cli{t: t, directory: directory, workspace: wid, token: token.Token, url: server.URL, binary: binary}, env, lost, collection.ID
}
func (c *cli) run(want int, arguments ...string) map[string]any {
	c.t.Helper()
	ctx, cancel := context.WithTimeout(c.t.Context(), 45*time.Second)
	defer cancel()
	args := []string{"--json", "--base-url", c.url, "--workspace", c.workspace, "--allow-http"}
	command := exec.CommandContext(ctx, c.binary, append(args, arguments...)...)
	command.Stdin = bytes.NewReader(c.stdin)
	for _, value := range os.Environ() {
		key, _, _ := strings.Cut(value, "=")
		if !strings.HasPrefix(key, "ORBIS_") {
			command.Env = append(command.Env, value)
		}
	}
	command.Env = append(command.Env, "ORBIS_TOKEN="+c.token, "ORBIS_CONFIG_DIR="+c.directory)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	code := 0
	if err != nil {
		if failure, ok := err.(*exec.ExitError); ok {
			code = failure.ExitCode()
		} else {
			c.t.Fatal(err)
		}
	}
	if code != want {
		c.t.Fatalf("CLI %v: exit%d want%d: %s %s", arguments, code, want, output, stderr.String())
	}
	if bytes.Contains(output, []byte(c.token)) || strings.Contains(stderr.String(), c.token) {
		c.t.Fatal("CLI leaked credential")
	}
	var envelope struct {
		Code string
		Data map[string]any
	}
	if err := json.Unmarshal(output, &envelope); err != nil {
		c.t.Fatalf("CLI did not emit one JSON envelope: %s %s", output, stderr.String())
	}
	return envelope.Data
}
func (c *cli) file(name string, value []byte) string {
	c.t.Helper()
	path := filepath.Join(c.directory, name)
	if err := os.WriteFile(path, value, 0600); err != nil {
		c.t.Fatal(err)
	}
	return path
}
func TestCLIDocumentEditRecoveryAttachmentsAndSharing(t *testing.T) {
	c, env, lost, cid := cliFixture(t, false)
	c.run(0, "doctor")
	c.run(0, "capabilities")
	c.run(0, "schema")
	c.run(0, "api", "ls")
	c.run(0, "workspaces", "list")
	c.run(0, "collections", "list", "--page-size", "1")
	md := c.file("draft.md", []byte("# Title\n\n**Draft** body\n\nSecond paragraph"))
	create := []string{"documents", "import", "--collection", cid, "--title", "CLI draft", "--operation-id", uuid.NewString(), "--file", md}
	created := c.run(0, create...)
	did := created["document_id"].(string)
	if c.run(0, create...)["document_id"] != did {
		t.Fatal("CLI constructor duplicated document")
	}
	c.run(0, "documents", "resolve", "--id", did)
	c.run(0, "documents", "list", "--collection", cid)
	c.run(0, "documents", "search", "CLI")
	c.run(0, "documents", "outline", did, "--version", "1")
	page := c.run(0, "blocks", "list", "--document", did, "--version", "1", "--page-size", "1")
	pagination := page["pagination"].(map[string]any)
	if pagination["has_more"] != true {
		t.Fatal("CLI did not preserve cursor pagination")
	}
	next := c.run(0, "blocks", "list", "--document", did, "--version", "1", "--page-size", "1", "--cursor", pagination["next_cursor"].(string))
	item := next["items"].([]any)[0].(map[string]any)
	bid := item["id"].(string)
	operation := uuid.NewString()
	body, _ := json.Marshal(map[string]any{"operation_id": operation, "expected_version": 1, "operations": []any{map[string]any{"type": "replace_text", "block_id": bid, "match": "Draft", "replacement": "Reviewed"}}})
	path := c.file("edit.json", body)
	c.run(0, "operations", "preview", "--document", did, "--file", path)
	lost.Store(true)
	applied := c.run(0, "operations", "apply", "--document", did, "--file", path)
	if applied["content_version"] != float64(2) {
		t.Fatal("CLI did not unwrap committed receipt after response loss")
	}
	c.run(0, "operations", "get", operation)
	c.run(0, "documents", "changes", did, "--since-version", "1", "--version", "2")
	c.run(0, "blocks", "get", bid, "--document", did, "--version", "2")
	c.run(0, "request", "get", "/api/v1/agent/workspaces/"+c.workspace+"/documents/"+did)
	c.run(0, "documents", "export", did, "--version", "2", "--format", "json", "--out", filepath.Join(c.directory, "export.json"))
	output := filepath.Join(c.directory, "export.md")
	c.run(0, "documents", "export", did, "--version", "2", "--format", "markdown", "--out", output)
	exported, err := os.ReadFile(output)
	if err != nil || !bytes.Contains(exported, []byte("**Reviewed**")) {
		t.Fatal("CLI export lost formatted edit")
	}
	attachment := []byte("private CLI attachment")
	uploaded := c.run(0, "files", "upload", "--document", did, "--file", c.file("report.txt", attachment), "--operation-id", uuid.NewString())
	c.run(0, "files", "get", uploaded["id"].(string), "--document", did)
	download := filepath.Join(c.directory, "download.txt")
	c.run(0, "files", "download", uploaded["id"].(string), "--document", did, "--out", download)
	content, err := os.ReadFile(download)
	if err != nil || !bytes.Equal(content, attachment) {
		t.Fatal("CLI attachment bytes changed")
	}
	shared := c.run(0, "shares", "create", "--collection", cid, "--root-document", did, "--acknowledge-public-scope")
	c.run(0, "shares", "list", "--collection", cid)
	share := shared["share"].(map[string]any)
	c.run(5, "shares", "revoke", share["id"].(string), "--expected-version", "999")
	c.run(0, "shares", "revoke", share["id"].(string), "--expected-version", "1")
	c.run(0, "shares", "revoke", share["id"].(string), "--expected-version", "1")
	c.stdin = []byte("# Small stdin without Redis")
	c.run(0, "documents", "import", "--collection", cid, "--title", "stdin document", "--operation-id", uuid.NewString(), "--file", "-")
	c.stdin = nil
	var count int64
	if err := env.DB.Table("documents").Count(&count).Error; err != nil || count != 2 {
		t.Fatal("CLI recovery created duplicate document or stdin import was not saved")
	}
}
func TestCLIStagedImportUsesDurableCompletionAndOriginalID(t *testing.T) {
	c, env, _, cid := cliFixture(t, true)
	source := c.file("large.md", []byte("# Large document\n\n"+strings.Repeat("A paragraph with readable content. ", 1600)+"\n\n"+strings.Repeat("Another paragraph with readable content. ", 13000)))
	args := []string{"documents", "import", "--collection", cid, "--title", "Large CLI document", "--operation-id", uuid.NewString(), "--file", source, "--wait-seconds", "30"}
	first := c.run(0, args...)
	if first["document_id"] == nil || first["import_id"] == nil {
		t.Fatal("CLI reported upload as complete without a document")
	}
	second := c.run(0, args...)
	if first["document_id"] != second["document_id"] {
		t.Fatal("CLI staged replay duplicated document")
	}
	c.run(0, "imports", "get", first["import_id"].(string))
	c.run(0, "imports", "finalize", first["import_id"].(string), "--wait-seconds", "0")
	c.run(0, "documents", "get", first["document_id"].(string))
	var count int64
	if err := env.DB.Table("documents").Count(&count).Error; err != nil || count != 1 {
		t.Fatal("staged CLI replay created duplicate document")
	}
}
