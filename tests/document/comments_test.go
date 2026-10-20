//go:build integration

package document_test

import (
	"orbis.local/orbis/tests/testenv"
	"strings"
	"sync"
	"testing"
	"time"
)

type comment struct {
	ID           string  `json:"id"`
	Body         string  `json:"body"`
	AuthorName   string  `json:"author_name"`
	ParentID     *string `json:"parent_id"`
	IsResolved   bool    `json:"is_resolved"`
	ResolvedAtMS *int64  `json:"resolved_at_ms"`
	Version      int64   `json:"version"`
	CreatedAtMS  int64   `json:"created_at_ms"`
	UpdatedAtMS  int64   `json:"updated_at_ms"`
}

func documentMember(t *testing.T, f fixture, email, role string) testenv.Session {
	t.Helper()
	user := f.env.AddUser(t, email)
	now := f.env.Clock.Now().UnixMilli()
	if err := f.env.DB.Exec(
		"INSERT INTO workspace_members (workspace_id,user_id,role,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?)",
		f.workspaceID,
		user.User.ID,
		role,
		now,
		now,
	).Error; err != nil {
		t.Fatal(err)
	}
	return user
}
func TestCommentRepliesPermissionsAndResolution(t *testing.T) {
	f := newDocument(t)
	env := f.env
	path := f.path + "/comments"
	viewer := documentMember(t, f, "viewer@example.test", "viewer")
	editor := documentMember(t, f, "editor@example.test", "editor")
	other := documentMember(t, f, "other@example.test", "viewer")
	empty := testenv.Decode[struct{ Items []comment }](t, env.Call(
		t,
		"GET",
		path,
		viewer.AccessToken,
		nil,
		200,
	))
	if empty.Items == nil || len(empty.Items) != 0 {
		t.Fatal("comments should start as an empty array")
	}
	initial := testenv.Decode[comment](t, env.Call(
		t,
		"POST",
		path,
		viewer.AccessToken,
		map[string]any{"body": "  文档讨论  "},
		201,
	))
	if initial.Body != "文档讨论" || initial.ParentID != nil || initial.IsResolved || initial.ResolvedAtMS != nil || initial.Version != 1 {
		t.Fatal("new comment state is incorrect")
	}
	reply := testenv.Decode[comment](t, env.Call(
		t,
		"POST",
		path,
		editor.AccessToken,
		map[string]any{"body": "回复", "parent_id": initial.ID},
		201,
	))
	if reply.ParentID == nil || *reply.ParentID != initial.ID {
		t.Fatal("reply lost its parent")
	}
	patch := path + "/" + initial.ID
	for _, token := range []string{editor.AccessToken, f.session.AccessToken, other.AccessToken} {
		env.Call(
			t,
			"PATCH",
			patch,
			token,
			map[string]any{"expected_version": 1, "body": "overwrite"},
			403,
		)
	}
	env.Call(
		t,
		"PATCH",
		patch,
		other.AccessToken,
		map[string]any{"expected_version": 1, "is_resolved": true},
		403,
	)
	env.Clock.Advance(23 * time.Millisecond)
	resolved := testenv.Decode[comment](t, env.Call(
		t,
		"PATCH",
		patch,
		editor.AccessToken,
		map[string]any{"expected_version": 1, "is_resolved": true},
		200,
	))
	if !resolved.IsResolved || resolved.ResolvedAtMS == nil || *resolved.ResolvedAtMS != env.Clock.Now().UnixMilli() || resolved.CreatedAtMS != initial.CreatedAtMS {
		t.Fatal("resolution timestamp is incorrect")
	}
	reopened := testenv.Decode[comment](t, env.Call(
		t,
		"PATCH",
		patch,
		viewer.AccessToken,
		map[string]any{"expected_version": 2, "body": "作者更新", "is_resolved": false},
		200,
	))
	if reopened.IsResolved || reopened.ResolvedAtMS != nil || reopened.Body != "作者更新" {
		t.Fatal("reopen or author edit failed")
	}
	env.Call(
		t,
		"PATCH",
		"/api/v1/me",
		viewer.AccessToken,
		map[string]any{"expected_version": 1, "display_name": nil},
		200,
	)
	env.Call(
		t,
		"DELETE",
		"/api/v1/workspaces/"+f.workspaceID+"/members/"+viewer.User.ID,
		f.session.AccessToken,
		map[string]any{"expected_version": 1},
		200,
	)
	env.Call(
		t,
		"GET",
		path,
		viewer.AccessToken,
		nil,
		404,
	)
	seen := map[string]comment{}
	for _, suffix := range []string{"?page=1&page_size=1", "?page=2&page_size=1"} {
		page := testenv.Decode[struct {
			Items      []comment
			Pagination struct{ Total int64 }
		}](t, env.Call(
			t,
			"GET",
			path+suffix,
			f.session.AccessToken,
			nil,
			200,
		))
		if len(page.Items) != 1 || page.Pagination.Total != 2 {
			t.Fatal("incorrect comment pagination")
		}
		seen[page.Items[0].ID] = page.Items[0]
	}
	if len(seen) != 2 || seen[initial.ID].AuthorName != "未命名用户" || seen[reply.ID].IsResolved {
		t.Fatal("history, author fallback, or independent reply state is incorrect")
	}
	content := testenv.Decode[struct {
		ContentVersion int64 `json:"content_version"`
	}](t, env.Call(
		t,
		"GET",
		f.path,
		f.session.AccessToken,
		nil,
		200,
	))
	if content.ContentVersion != 1 {
		t.Fatal("comment edits changed document content version")
	}
}

func TestCommentValidationScopeAndArchives(t *testing.T) {
	f := newDocument(t)
	env := f.env
	token := f.session.AccessToken
	path := f.path + "/comments"
	row := testenv.Decode[comment](t, env.Call(
		t,
		"POST",
		path,
		token,
		map[string]any{"body": "original"},
		201,
	))
	second := createNode(t, f, "Second", nil)
	otherPath := nodePath(f, second.ID) + "/comments"
	env.Call(
		t,
		"POST",
		otherPath,
		token,
		map[string]any{"body": "wrong parent", "parent_id": row.ID},
		404,
	)
	env.Call(
		t,
		"PATCH",
		otherPath+"/"+row.ID,
		token,
		map[string]any{"expected_version": 1, "body": "wrong target"},
		404,
	)
	outsider := env.AddUser(t, "outsider@example.test")
	env.Call(
		t,
		"GET",
		path,
		outsider.AccessToken,
		nil,
		404,
	)
	env.Call(
		t,
		"POST",
		path,
		outsider.AccessToken,
		map[string]any{"body": "unauthorized"},
		404,
	)
	for _, body := range []map[string]any{{"body": " "}, {"body": strings.Repeat("界", 10001)}, {"body": "x", "parent_id": "bad"}, {"body": "a\x00b"}} {
		env.Call(
			t,
			"POST",
			path,
			token,
			body,
			422,
		)
	}
	for _, body := range []map[string]any{
		{"expected_version": 1},
		{"expected_version": 1, "body": nil},
		{"expected_version": 1, "is_resolved": nil},
		{"expected_version": 0, "is_resolved": true},
	} {
		env.Call(
			t,
			"PATCH",
			path+"/"+row.ID,
			token,
			body,
			422,
		)
	}
	env.Call(
		t,
		"GET",
		path+"?page_size=101",
		token,
		nil,
		422,
	)
	archiveNode(t, f, f.documentID, true, 200)
	env.Call(
		t,
		"GET",
		path,
		token,
		nil,
		404,
	)
	env.Call(
		t,
		"POST",
		path,
		token,
		map[string]any{"body": "hidden"},
		404,
	)
	env.Call(
		t,
		"PATCH",
		path+"/"+row.ID,
		token,
		map[string]any{"expected_version": 1, "is_resolved": true},
		404,
	)
	archiveNode(t, f, f.documentID, false, 200)
	page := testenv.Decode[struct{ Items []comment }](t, env.Call(
		t,
		"GET",
		path,
		token,
		nil,
		200,
	))
	if len(page.Items) != 1 || page.Items[0].Body != "original" {
		t.Fatal("archive damaged comments")
	}
}

func TestConcurrentCommentUpdates(t *testing.T) {
	f := newDocument(t)
	path := f.path + "/comments"
	token := f.session.AccessToken
	row := testenv.Decode[comment](t, f.env.Call(
		t,
		"POST",
		path,
		token,
		map[string]any{"body": "original"},
		201,
	))
	type outcome struct {
		result testenv.Result
		err    error
	}
	results := make(chan outcome, 2)
	var workers sync.WaitGroup
	for _, body := range []string{"first", "second"} {
		workers.Go(func() {
			result, err := f.env.Do("PATCH", path+"/"+row.ID, token, map[string]any{"expected_version": 1, "body": body})
			results <- outcome{result: result, err: err}
		})
	}
	workers.Wait()
	close(results)
	statuses := map[int]int{}
	for result := range results {
		if result.err != nil {
			t.Fatal(result.err)
		}
		statuses[result.result.Status]++
		if result.result.Status == 409 && result.result.Code != "COMMENT_VERSION_CONFLICT" {
			t.Fatal("wrong conflict code")
		}
	}
	if statuses[200] != 1 || statuses[409] != 1 {
		t.Fatalf("concurrent comment updates: %v", statuses)
	}
}
