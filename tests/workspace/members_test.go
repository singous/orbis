//go:build integration

package workspace_test

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"orbis.local/orbis/tests/testenv"
)

type member struct {
	UserID  string `json:"user_id"`
	Role    string `json:"role"`
	Version int64  `json:"version"`
}

func addMember(t *testing.T, env *testenv.Environment, workspaceID, email, role string) testenv.Session {
	t.Helper()
	user := env.AddUser(t, email)
	now := env.Clock.Now().UnixMilli()
	if err := env.DB.Exec(
		"INSERT INTO workspace_members (workspace_id,user_id,role,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?)",
		workspaceID,
		user.User.ID,
		role,
		now,
		now,
	).Error; err != nil {
		t.Fatal(err)
	}
	return user
}

func TestMemberPermissionsAndRemoval(t *testing.T) {
	env := testenv.New(t)
	owner, wid := env.Owner(t)
	admin := addMember(
		t,
		env,
		wid,
		"admin@example.test",
		"admin",
	)
	editor := addMember(
		t,
		env,
		wid,
		"editor@example.test",
		"editor",
	)
	viewer := addMember(
		t,
		env,
		wid,
		"viewer@example.test",
		"viewer",
	)
	base := "/api/v1/workspaces/" + wid
	listing := testenv.Decode[struct {
		Items      []member `json:"items"`
		Pagination struct {
			Total int64 `json:"total"`
		} `json:"pagination"`
	}](t,
		env.Call(
			t,
			"GET",
			base+"/members?page_size=2",
			viewer.AccessToken,
			nil,
			http.StatusOK,
		))
	if listing.Pagination.Total != 4 || len(listing.Items) != 2 {
		t.Fatal("member pagination is incorrect")
	}
	for _, test := range []struct {
		name, token, target, role string
		status                    int
	}{
		{name: "editor cannot manage", token: editor.AccessToken, target: viewer.User.ID, role: "editor", status: 403},
		{name: "admin cannot promote", token: admin.AccessToken, target: viewer.User.ID, role: "admin", status: 403},
		{
			name:   "admin cannot manage admin",
			token:  admin.AccessToken,
			target: admin.User.ID,
			role:   "viewer",
			status: 403,
		},
		{name: "owner role protected", token: owner.AccessToken, target: owner.User.ID, role: "viewer", status: 409},
		{
			name:   "owner cannot be assigned",
			token:  owner.AccessToken,
			target: viewer.User.ID,
			role:   "owner",
			status: 422,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			env.Call(
				t,
				"PATCH",
				base+"/members/"+test.target,
				test.token,
				map[string]any{"role": test.role, "expected_version": 1},
				test.status,
			)
		})
	}
	changed := testenv.Decode[member](t, env.Call(
		t,
		"PATCH",
		base+"/members/"+viewer.User.ID,
		owner.AccessToken,
		map[string]any{"role": "admin", "expected_version": 1},
		http.StatusOK,
	))
	if changed.Role != "admin" || changed.Version != 2 {
		t.Fatal("role update did not advance the member version")
	}
	conflict := env.Call(
		t,
		"PATCH",
		base+"/members/"+viewer.User.ID,
		owner.AccessToken,
		map[string]any{"role": "editor", "expected_version": 1},
		http.StatusConflict,
	)
	if conflict.Code != "MEMBER_VERSION_CONFLICT" {
		t.Fatal("unexpected member conflict")
	}
	other := testenv.Decode[struct {
		ID string `json:"id"`
	}](t, env.Call(
		t,
		"POST",
		"/api/v1/workspaces",
		editor.AccessToken,
		map[string]any{"name": "Other workspace"},
		http.StatusCreated,
	))
	collection := testenv.Decode[struct {
		ID string `json:"id"`
	}](t, env.Call(
		t,
		"POST",
		base+"/collections",
		editor.AccessToken,
		map[string]any{"title": "Authored"},
		http.StatusCreated,
	))
	doc := testenv.Decode[struct {
		ID string `json:"id"`
	}](t, env.Call(
		t,
		"POST",
		base+"/collections/"+collection.ID+"/documents",
		editor.AccessToken,
		map[string]any{"title": "Preserved"},
		http.StatusCreated,
	))
	env.Call(
		t,
		"DELETE",
		base+"/members/"+editor.User.ID,
		owner.AccessToken,
		map[string]any{"expected_version": 1},
		http.StatusOK,
	)
	env.Call(
		t,
		"GET",
		base+"/documents/"+doc.ID,
		editor.AccessToken,
		nil,
		http.StatusNotFound,
	)
	env.Call(
		t,
		"GET",
		base+"/documents/"+doc.ID,
		owner.AccessToken,
		nil,
		http.StatusOK,
	)
	env.Call(
		t,
		"GET",
		"/api/v1/me",
		editor.AccessToken,
		nil,
		http.StatusOK,
	)
	env.Call(
		t,
		"GET",
		"/api/v1/workspaces/"+other.ID+"/members",
		editor.AccessToken,
		nil,
		http.StatusOK,
	)
	env.Call(
		t,
		"GET",
		base+"/members",
		editor.AccessToken,
		nil,
		http.StatusNotFound,
	)
	env.Call(
		t,
		"DELETE",
		base+"/members/"+owner.User.ID,
		owner.AccessToken,
		map[string]any{"expected_version": 1},
		http.StatusConflict,
	)
	env.Call(
		t,
		"DELETE",
		base+"/members/"+viewer.User.ID,
		viewer.AccessToken,
		map[string]any{"expected_version": 2},
		http.StatusOK,
	)
	env.Call(
		t,
		"GET",
		base+"/members",
		viewer.AccessToken,
		nil,
		http.StatusNotFound,
	)
}

func TestConcurrentMemberRoleUpdates(t *testing.T) {
	env := testenv.New(t)
	owner, wid := env.Owner(t)
	viewer := addMember(
		t,
		env,
		wid,
		"viewer@example.test",
		"viewer",
	)
	results := make(chan testenv.Result, 2)
	errors := make(chan error, 2)
	var workers sync.WaitGroup
	for _, role := range []string{"admin", "editor"} {
		workers.Go(func() {
			result, err := env.Do(
				"PATCH",
				"/api/v1/workspaces/"+wid+"/members/"+viewer.User.ID,
				owner.AccessToken,
				map[string]any{"role": role, "expected_version": 1},
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
		t.Fatalf("unexpected concurrent statuses: %v", statuses)
	}
}

func waitForLock(t *testing.T, env *testenv.Environment, pattern string) {
	t.Helper()
	deadline, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		if err := env.DB.WithContext(deadline).Raw(
			"SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE ?)", pattern,
		).Scan(&waiting).Error; err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		select {
		case <-ticker.C:
		case <-deadline.Done():
			t.Fatal("request did not reach the expected row lock")
		}
	}
}

func TestRoleRevocationWaitsForAuthorizedWrite(t *testing.T) {
	env := testenv.New(t)
	owner, wid := env.Owner(t)
	editor := addMember(
		t,
		env,
		wid,
		"editor@example.test",
		"editor",
	)
	base := "/api/v1/workspaces/" + wid
	collection := testenv.Decode[struct {
		ID string `json:"id"`
	}](t, env.Call(
		t,
		"POST",
		base+"/collections",
		owner.AccessToken,
		map[string]any{"title": "Locked"},
		201,
	))
	doc := testenv.Decode[struct {
		ID string `json:"id"`
	}](t, env.Call(
		t,
		"POST",
		base+"/collections/"+collection.ID+"/documents",
		owner.AccessToken,
		map[string]any{"title": "Initial"},
		201,
	))
	pool, err := env.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	blocker, err := pool.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = blocker.Rollback() })
	if _, err := blocker.ExecContext(t.Context(), "SELECT id FROM collections WHERE id=$1 FOR NO KEY UPDATE", collection.ID); err != nil {
		t.Fatal(err)
	}
	type outcome struct {
		result testenv.Result
		err    error
	}
	written, changed := make(chan outcome, 1), make(chan outcome, 1)
	go func() {
		result, err := env.Do(
			"PUT",
			base+"/documents/"+doc.ID+"/content",
			editor.AccessToken,
			map[string]any{
				"operation_id": uuid.NewString(), "expected_version": 1, "title": "Authorized write", "blocks": []any{},
			},
		)
		written <- outcome{result: result, err: err}
	}()
	waitForLock(t, env, "%collections%FOR SHARE%")
	go func() {
		result, err := env.Do(
			"PATCH",
			base+"/members/"+editor.User.ID,
			owner.AccessToken,
			map[string]any{"role": "viewer", "expected_version": 1},
		)
		changed <- outcome{result: result, err: err}
	}()
	waitForLock(t, env, "%workspace_members%FOR UPDATE%")
	if err := blocker.Commit(); err != nil {
		t.Fatal(err)
	}
	for _, channel := range []chan outcome{written, changed} {
		result := <-channel
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.result.Status != 200 {
			t.Fatalf("contending operation failed with %d", result.result.Status)
		}
	}
	env.Call(
		t,
		"PUT",
		base+"/documents/"+doc.ID+"/content",
		editor.AccessToken,
		map[string]any{
			"operation_id": uuid.NewString(), "expected_version": 2, "title": "Forbidden write", "blocks": []any{},
		},
		http.StatusForbidden,
	)
	env.Call(
		t,
		"GET",
		base+"/documents/"+doc.ID+"/content",
		editor.AccessToken,
		nil,
		http.StatusOK,
	)
}
