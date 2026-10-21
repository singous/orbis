//go:build integration

package identity_test

import (
	"net/http"
	"sync"
	"testing"

	"orbis.local/orbis/tests/testenv"
)

func TestSetupIsAtomic(t *testing.T) {
	env := testenv.New(t)
	results := make(chan testenv.Result, 2)
	errors := make(chan error, 2)
	var workers sync.WaitGroup
	for _, email := range []string{"first@example.test", "second@example.test"} {
		workers.Go(func() {
			result, err := env.Do(
				"POST",
				"/api/v1/setup",
				"",
				map[string]any{
					"email": email, "password": testenv.Password, "display_name": "Test Owner", "workspace_name": "Test Workspace",
				},
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
	if statuses[http.StatusCreated] != 1 || statuses[http.StatusConflict] != 1 {
		t.Fatalf("unexpected statuses: %v", statuses)
	}
	for _, table := range []string{"users", "workspaces", "workspace_members", "collection_groups"} {
		var count int64
		if err := env.DB.Table(table).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("%s contains %d rows after competing initialization", table, count)
		}
	}
}

func TestRefreshRotationAndRevocation(t *testing.T) {
	env := testenv.New(t)
	session, _ := env.Owner(t)
	env.Call(
		t,
		"GET",
		"/api/v1/me",
		session.AccessToken,
		nil,
		http.StatusOK,
	)
	refresh := map[string]any{"refresh_token": session.RefreshToken}
	next := testenv.Decode[testenv.Session](t, env.Call(
		t,
		"POST",
		"/api/v1/auth/refresh",
		"",
		refresh,
		http.StatusOK,
	))
	if next.RefreshToken == session.RefreshToken {
		t.Fatal("refresh token did not rotate")
	}
	env.Call(
		t,
		"POST",
		"/api/v1/auth/refresh",
		"",
		refresh,
		http.StatusUnauthorized,
	)
	env.Call(
		t,
		"POST",
		"/api/v1/auth/logout",
		next.AccessToken,
		nil,
		http.StatusOK,
	)
	env.Call(
		t,
		"GET",
		"/api/v1/me",
		session.AccessToken,
		nil,
		http.StatusUnauthorized,
	)
	env.Call(
		t,
		"POST",
		"/api/v1/auth/refresh",
		"",
		map[string]any{"refresh_token": next.RefreshToken},
		http.StatusUnauthorized,
	)
}

func TestConcurrentRefreshHasOneWinner(t *testing.T) {
	env := testenv.New(t)
	session, _ := env.Owner(t)
	results := make(chan testenv.Result, 2)
	errors := make(chan error, 2)
	var workers sync.WaitGroup
	for range 2 {
		workers.Go(func() {
			result, err := env.Do(
				"POST",
				"/api/v1/auth/refresh",
				"",
				map[string]any{"refresh_token": session.RefreshToken},
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
	if statuses[http.StatusOK] != 1 || statuses[http.StatusUnauthorized] != 1 {
		t.Fatalf("unexpected refresh statuses: %v", statuses)
	}
}
