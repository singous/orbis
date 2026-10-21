//go:build integration

package identity_test

import (
	"testing"

	"orbis.local/orbis/tests/testenv"
)

func TestInactiveAccountCannotUsePasswordAccessOrRefresh(t *testing.T) {
	env := testenv.New(t)
	session, _ := env.Owner(t)
	if err := env.DB.Exec("UPDATE users SET is_active=FALSE WHERE id=?", session.User.ID).Error; err != nil {
		t.Fatal(err)
	}
	env.Call(t, "GET", "/api/v1/me", session.AccessToken, nil, 401)
	env.Call(t, "POST", "/api/v1/auth/refresh", "", map[string]any{"refresh_token": session.RefreshToken}, 401)
	env.Call(t, "POST", "/api/v1/auth/login", "", map[string]any{"email": "owner@example.test", "password": testenv.Password}, 401)
}
func TestWorkspacePreferenceIsSeparateFromAuthorizationAndProfileVersion(t *testing.T) {
	env := testenv.New(t)
	session, initial := env.Owner(t)
	other := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", "/api/v1/workspaces", session.AccessToken, map[string]any{"name": "Preferred workspace"}, 201))
	user := testenv.Decode[struct {
		ID        string
		Preferred *string `json:"preferred_workspace_id"`
		Version   int64   `json:"profile_version"`
	}](t, env.Call(t, "PUT", "/api/v1/me/workspace-preference", session.AccessToken, map[string]any{"workspace_id": other.ID}, 200))
	if user.Preferred == nil || *user.Preferred != other.ID || user.Version != 1 {
		t.Fatal("workspace preference changed profile concurrency or was not persisted")
	}
	stranger := env.AddUser(t, "stranger@example.test")
	foreign := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", "/api/v1/workspaces", stranger.AccessToken, map[string]any{"name": "Foreign"}, 201))
	env.Call(t, "PUT", "/api/v1/me/workspace-preference", session.AccessToken, map[string]any{"workspace_id": foreign.ID}, 404)
	env.Call(t, "GET", "/api/v1/workspaces/"+initial+"/collections", session.AccessToken, nil, 200)
	env.Call(t, "GET", "/api/v1/workspaces/"+foreign.ID+"/collections", session.AccessToken, nil, 404)
	cleared := env.Call(t, "PUT", "/api/v1/me/workspace-preference", session.AccessToken, map[string]any{"workspace_id": nil}, 200)
	clearUser := testenv.Decode[struct {
		Preferred *string `json:"preferred_workspace_id"`
	}](t, cleared)
	if clearUser.Preferred != nil {
		t.Fatal("explicit null did not clear the preference")
	}
	env.Call(t, "PUT", "/api/v1/me/workspace-preference", session.AccessToken, map[string]any{}, 422)
}
