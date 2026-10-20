//go:build integration

package identity_test

import (
	"orbis.local/orbis/tests/testenv"
	"strings"
	"sync"
	"testing"
	"time"
)

type profile struct {
	ID, Email   string
	DisplayName *string `json:"display_name"`
	Bio         *string `json:"bio"`
	Version     int64   `json:"profile_version"`
	CreatedAtMS int64   `json:"created_at_ms"`
	UpdatedAtMS int64   `json:"updated_at_ms"`
}

func TestProfilePatchPresenceAndAuthentication(t *testing.T) {
	env := testenv.New(t)
	owner, _ := env.Owner(t)
	before := testenv.Decode[profile](t, env.Call(
		t,
		"GET",
		"/api/v1/me",
		owner.AccessToken,
		nil,
		200,
	))
	env.Clock.Advance(1234 * time.Millisecond)
	edited := testenv.Decode[profile](t, env.Call(
		t,
		"PATCH",
		"/api/v1/me",
		owner.AccessToken,
		map[string]any{"expected_version": 1, "display_name": "  新名称  ", "bio": "  测试简介  "},
		200,
	))
	if edited.DisplayName == nil || *edited.DisplayName != "新名称" || edited.Bio == nil || *edited.Bio != "测试简介" || edited.Email != before.Email || edited.Version != 2 || edited.CreatedAtMS != before.CreatedAtMS || edited.UpdatedAtMS != before.UpdatedAtMS+1234 {
		t.Fatal("profile normalization or timestamps are incorrect")
	}
	retained := testenv.Decode[profile](t, env.Call(
		t,
		"PATCH",
		"/api/v1/me",
		owner.AccessToken,
		map[string]any{"expected_version": 2, "bio": nil},
		200,
	))
	if retained.DisplayName == nil || *retained.DisplayName != "新名称" || retained.Bio != nil {
		t.Fatal("omitted and null fields were not distinguished")
	}
	cleared := testenv.Decode[profile](t, env.Call(
		t,
		"PATCH",
		"/api/v1/me",
		owner.AccessToken,
		map[string]any{"expected_version": 3, "display_name": nil},
		200,
	))
	if cleared.DisplayName != nil || cleared.Bio != nil {
		t.Fatal("profile fields were not cleared")
	}
	var stored struct {
		DisplayName, Bio *string
		ProfileVersion   int64
	}
	if err := env.DB.Table("users").Where("id = ?", owner.User.ID).Take(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.DisplayName != nil || stored.Bio != nil || stored.ProfileVersion != 4 {
		t.Fatal("nullable profile did not round trip")
	}
	loggedIn := env.Login(t, "owner@example.test")
	if loggedIn.User.ID != owner.User.ID {
		t.Fatal("profile edit changed account identity")
	}
	for _, body := range []map[string]any{
		{"expected_version": 4}, {"expected_version": 4, "display_name": "   "},
		{"expected_version": 4, "bio": strings.Repeat("界", 501)}, {"expected_version": 0, "bio": "x"},
		{"expected_version": 4, "bio": true},
		{"expected_version": 4, "bio": "a\x00b"},
		{"expected_version": 4, "display_name": "a\x00b"},
	} {
		env.Call(
			t,
			"PATCH",
			"/api/v1/me",
			owner.AccessToken,
			body,
			422,
		)
	}
	env.Call(
		t,
		"PATCH",
		"/api/v1/me",
		owner.AccessToken,
		map[string]any{"expected_version": 4, "email": "other@example.test"},
		400,
	)
	env.Call(
		t,
		"PATCH",
		"/api/v1/me",
		"",
		map[string]any{"expected_version": 4, "bio": "x"},
		401,
	)
	conflict := env.Call(
		t,
		"PATCH",
		"/api/v1/me",
		owner.AccessToken,
		map[string]any{"expected_version": 1, "bio": "stale"},
		409,
	)
	if conflict.Code != "PROFILE_VERSION_CONFLICT" {
		t.Fatal("missing profile conflict code")
	}
}

func TestConcurrentProfileUpdates(t *testing.T) {
	env := testenv.New(t)
	owner, _ := env.Owner(t)
	type outcome struct {
		result testenv.Result
		err    error
	}
	results := make(chan outcome, 2)
	var workers sync.WaitGroup
	for _, bio := range []string{"first", "second"} {
		workers.Go(func() {
			result, err := env.Do("PATCH", "/api/v1/me", owner.AccessToken, map[string]any{"expected_version": 1, "bio": bio})
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
	}
	if statuses[200] != 1 || statuses[409] != 1 {
		t.Fatalf("concurrent updates: %v", statuses)
	}
	saved := testenv.Decode[profile](t, env.Call(
		t,
		"GET",
		"/api/v1/me",
		owner.AccessToken,
		nil,
		200,
	))
	if saved.Version != 2 {
		t.Fatal("profile version skipped after conflict")
	}
}

func TestDefaultGroupFailureRollsBackWorkspaceCreation(t *testing.T) {
	env := testenv.New(t)
	reject := func() {
		t.Helper()
		if err := env.DB.Exec("ALTER TABLE collection_groups ADD CONSTRAINT test_reject_default CHECK (NOT is_default) NOT VALID").Error; err != nil {
			t.Fatal(err)
		}
	}
	allow := func() {
		t.Helper()
		if err := env.DB.Exec("ALTER TABLE collection_groups DROP CONSTRAINT test_reject_default").Error; err != nil {
			t.Fatal(err)
		}
	}
	counts := func(expected int64) {
		t.Helper()
		for _, table := range []string{"users", "workspaces", "workspace_members", "collection_groups"} {
			var actual int64
			if err := env.DB.Table(table).Count(&actual).Error; err != nil {
				t.Fatal(err)
			}
			if actual != expected {
				t.Fatalf("%s: got %d records, want %d", table, actual, expected)
			}
		}
	}
	reject()
	env.Call(t, "POST", "/api/v1/setup", "", map[string]any{
		"email": "owner@example.test", "password": testenv.Password,
		"display_name": "Owner", "workspace_name": "Workspace",
	}, 500)
	counts(0)
	status := testenv.Decode[struct{ Initialized bool }](t, env.Call(t, "GET", "/api/v1/setup", "", nil, 200))
	if status.Initialized {
		t.Fatal("failed catalog initialization completed setup")
	}
	allow()
	owner, _ := env.Owner(t)
	reject()
	env.Call(t, "POST", "/api/v1/workspaces", owner.AccessToken, map[string]any{"name": "Failed workspace"}, 500)
	counts(1)
	allow()
	env.Call(t, "POST", "/api/v1/workspaces", owner.AccessToken, map[string]any{"name": "Successful workspace"}, 201)
	var groups int64
	if err := env.DB.Table("collection_groups").Count(&groups).Error; err != nil {
		t.Fatal(err)
	}
	if groups != 2 {
		t.Fatal("workspace creation did not recover after catalog failure")
	}
}
