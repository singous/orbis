//go:build integration

package workspace_test

import (
	"context"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
	"orbis.local/orbis/tests/testenv"
)

type invitation struct {
	ID                string  `json:"id"`
	Status            string  `json:"status"`
	Role              string  `json:"role"`
	EmailSent         bool    `json:"email_sent"`
	EmailErrorSummary *string `json:"email_error_summary"`
	ExpiresAtMS       int64   `json:"expires_at_ms"`
}

type joined struct {
	User struct {
		ID          string `json:"id"`
		DisplayName string `json:"display_name"`
	} `json:"user"`
	Member  member           `json:"member"`
	Session *testenv.Session `json:"session"`
}

func invitationPath(wid string) string { return "/api/v1/workspaces/" + wid + "/invitations" }

func invite(t *testing.T, env *testenv.Environment, owner testenv.Session, wid, email, role string) (invitation, workspace.ActionMail) {
	t.Helper()
	result := env.Call(t, "POST", invitationPath(wid), owner.AccessToken, map[string]any{"email": email, "role": role}, 201)
	item := testenv.Decode[invitation](t, result)
	if !item.EmailSent {
		t.Fatal("invitation email was not delivered")
	}
	message := env.Mail(t, item.ID)
	if strings.Contains(string(result.Data), message.Token) || strings.Contains(string(result.Data), "token_hash") || strings.Contains(string(result.Data), "accept_url") {
		t.Fatal("management API exposed a capability")
	}
	parsed, err := url.Parse(message.URL)
	if err != nil {
		t.Fatal(err)
	}
	fragment, err := url.ParseQuery(parsed.Fragment)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.RawQuery != "" || fragment.Get("token") != message.Token {
		t.Fatal("mail link must keep its capability in the fragment")
	}
	return item, message
}

func joinBody(token string) map[string]any {
	return map[string]any{"token": token, "password": testenv.Password, "display_name": "Invited user"}
}

func TestInvitationRegistrationAndExistingAccount(t *testing.T) {
	env := testenv.NewWithMail(t)
	owner, wid := env.Owner(t)
	_, message := invite(t, env, owner, wid, "New@Example.test", "editor")
	if message.Recipient != "new@example.test" {
		t.Fatal("recipient email was not normalized")
	}
	env.Call(t, "POST", "/api/v1/invitations/inspect", "", map[string]any{"token": message.Token}, 200)
	env.Call(t, "POST", "/api/v1/invitations/accept", "", map[string]any{"token": message.Token}, 422)
	result := testenv.Decode[joined](t, env.Call(t, "POST", "/api/v1/invitations/accept", "", joinBody(message.Token), 200))
	if result.Session == nil || result.Member.Role != "editor" || result.Member.UserID != result.User.ID {
		t.Fatal("new registration did not atomically join and sign in")
	}
	env.Call(t, "GET", "/api/v1/me", result.Session.AccessToken, nil, 200)
	env.Call(t, "GET", "/api/v1/workspaces/"+wid+"/members", result.Session.AccessToken, nil, 200)
	env.Call(t, "POST", "/api/v1/invitations/accept", "", joinBody(message.Token), 409)
	existing := env.AddUser(t, "existing@example.test")
	_, existingMail := invite(t, env, owner, wid, "existing@example.test", "viewer")
	anonymous := env.Call(t, "POST", "/api/v1/invitations/accept", "", joinBody(existingMail.Token), 401)
	if anonymous.Code != "INVITATION_LOGIN_REQUIRED" {
		t.Fatal("existing account was not protected by login")
	}
	env.Call(t, "POST", "/api/v1/invitations/accept", owner.AccessToken, joinBody(existingMail.Token), 403)
	accepted := testenv.Decode[joined](t, env.Call(t, "POST", "/api/v1/invitations/accept", existing.AccessToken,
		map[string]any{"token": existingMail.Token, "password": "replacement-password", "display_name": "Must not replace"}, 200))
	if accepted.Session != nil || accepted.User.ID != existing.User.ID || accepted.User.DisplayName != "Test User" {
		t.Fatal("existing account was replaced or reauthenticated")
	}
	env.Login(t, "existing@example.test")
	env.Call(t, "DELETE", "/api/v1/workspaces/"+wid+"/members/"+existing.User.ID, owner.AccessToken, map[string]any{"expected_version": 1}, 200)
	_, reinvite := invite(t, env, owner, wid, "existing@example.test", "editor")
	returning := testenv.Decode[joined](t, env.Call(t, "POST", "/api/v1/invitations/accept", existing.AccessToken, map[string]any{"token": reinvite.Token}, 200))
	if returning.User.ID != existing.User.ID || returning.Member.Role != "editor" {
		t.Fatal("removed member could not rejoin with their existing account")
	}
}

func TestInvitationLifecycleAndPrivileges(t *testing.T) {
	env := testenv.NewWithMail(t)
	owner, wid := env.Owner(t)
	admin := addMember(t, env, wid, "admin@example.test", "admin")
	viewer := addMember(t, env, wid, "viewer@example.test", "viewer")
	env.Call(t, "POST", invitationPath(wid), admin.AccessToken, map[string]any{"email": "escalation@example.test", "role": "admin"}, 403)
	env.Call(t, "GET", invitationPath(wid), viewer.AccessToken, nil, 403)
	env.Call(t, "POST", invitationPath(wid), owner.AccessToken, map[string]any{"email": "viewer@example.test", "role": "editor"}, 409)
	privileged, _ := invite(t, env, owner, wid, "future-admin@example.test", "admin")
	env.Call(t, "POST", invitationPath(wid)+"/"+privileged.ID+"/resend", admin.AccessToken, nil, 403)
	env.Call(t, "POST", invitationPath(wid)+"/"+privileged.ID+"/revoke", admin.AccessToken, nil, 403)
	item, original := invite(t, env, admin, wid, "person@example.test", "viewer")
	env.Clock.Advance(time.Second)
	resend := testenv.Decode[invitation](t, env.Call(t, "POST", invitationPath(wid)+"/"+item.ID+"/resend", admin.AccessToken, nil, 200))
	rotated := env.Mail(t, item.ID)
	if rotated.Token == original.Token || resend.ExpiresAtMS <= item.ExpiresAtMS {
		t.Fatal("resend did not rotate or extend the invitation")
	}
	env.Call(t, "POST", "/api/v1/invitations/accept", "", joinBody(original.Token), 409)
	env.Call(t, "POST", invitationPath(wid)+"/"+item.ID+"/revoke", owner.AccessToken, nil, 200)
	env.Call(t, "POST", "/api/v1/invitations/inspect", "", map[string]any{"token": rotated.Token}, 409)
	old, oldMail := invite(t, env, owner, wid, "replace@example.test", "viewer")
	newer, _ := invite(t, env, owner, wid, "replace@example.test", "editor")
	if old.ID == newer.ID {
		t.Fatal("replacement invitation reused the old record")
	}
	env.Call(t, "POST", "/api/v1/invitations/inspect", "", map[string]any{"token": oldMail.Token}, 409)
	expires := testenv.Decode[invitation](t, env.Call(t, "POST", invitationPath(wid), owner.AccessToken, map[string]any{"email": "expiry@example.test", "role": "viewer", "ttl_seconds": 60}, 201))
	expiredMail := env.Mail(t, expires.ID)
	env.Clock.Advance(time.Minute + time.Millisecond)
	response := env.Call(t, "POST", "/api/v1/invitations/accept", "", joinBody(expiredMail.Token), 409)
	if response.Code != "INVITATION_EXPIRED" {
		t.Fatal("expired invitation was not rejected")
	}
	env.Call(t, "POST", invitationPath(wid)+"/"+expires.ID+"/resend", owner.AccessToken, nil, 409)
	other := testenv.Decode[struct {
		ID string `json:"id"`
	}](t, env.Call(t, "POST", "/api/v1/workspaces", owner.AccessToken, map[string]any{"name": "Other"}, 201))
	env.Call(t, "POST", invitationPath(other.ID)+"/"+newer.ID+"/resend", owner.AccessToken, nil, 404)
}

func TestFailedInvitationDeliveryCanBeRetried(t *testing.T) {
	env := testenv.NewWithMail(t)
	owner, wid := env.Owner(t)
	if err := os.WriteFile(env.OutboxDir, []byte("blocked mailbox"), 0600); err != nil {
		t.Fatal(err)
	}
	failed := testenv.Decode[invitation](t, env.Call(t, "POST", invitationPath(wid), owner.AccessToken, map[string]any{"email": "retry@example.test", "role": "viewer"}, 201))
	if failed.Status != "pending" || failed.EmailSent || failed.EmailErrorSummary == nil {
		t.Fatal("failed delivery did not leave a retryable pending invitation")
	}
	var oldHash string
	if err := env.DB.Table("workspace_invitations").Select("token_hash").Where("id=?", failed.ID).Scan(&oldHash).Error; err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(env.OutboxDir); err != nil {
		t.Fatal(err)
	}
	resent := testenv.Decode[invitation](t, env.Call(t, "POST", invitationPath(wid)+"/"+failed.ID+"/resend", owner.AccessToken, nil, 200))
	if !resent.EmailSent || resent.EmailErrorSummary != nil {
		t.Fatal("successful resend did not clear the previous failure")
	}
	if err := wsstore.NewActions(env.DB, env.Clock).RecordDelivery(t.Context(), workspace.DeliveryResult{
		Kind: workspace.InvitationMail, ID: failed.ID, TokenHash: oldHash, Sent: false, Timestamp: env.Clock.Now().UnixMilli(),
	}); err != nil {
		t.Fatal(err)
	}
	listed := testenv.Decode[struct {
		Items []invitation `json:"items"`
	}](t, env.Call(t, "GET", invitationPath(wid), owner.AccessToken, nil, 200))
	if len(listed.Items) != 1 || !listed.Items[0].EmailSent || listed.Items[0].EmailErrorSummary != nil {
		t.Fatal("late delivery overwrote a newer generation")
	}
	message := env.Mail(t, failed.ID)
	env.Call(t, "POST", "/api/v1/invitations/accept", "", joinBody(message.Token), 200)
}

func TestConcurrentInviteAcceptanceAndRevocation(t *testing.T) {
	env := testenv.NewWithMail(t)
	owner, wid := env.Owner(t)
	item, message := invite(t, env, owner, wid, "race@example.test", "viewer")
	type outcome struct {
		result testenv.Result
		err    error
	}
	results := make(chan outcome, 2)
	go func() {
		result, err := env.Do("POST", "/api/v1/invitations/accept", "", joinBody(message.Token))
		results <- outcome{result: result, err: err}
	}()
	go func() {
		result, err := env.Do("POST", invitationPath(wid)+"/"+item.ID+"/revoke", owner.AccessToken, nil)
		results <- outcome{result: result, err: err}
	}()
	statuses := map[int]int{}
	for range 2 {
		result := <-results
		if result.err != nil {
			t.Fatal(result.err)
		}
		statuses[result.result.Status]++
	}
	if statuses[200] != 1 || statuses[409] != 1 {
		t.Fatalf("unexpected acceptance/revocation outcomes: %v", statuses)
	}
	env.Call(t, "POST", "/api/v1/invitations/accept", "", joinBody(message.Token), 409)
}

func TestConcurrentRegistrationUsesOneAccount(t *testing.T) {
	env := testenv.NewWithMail(t)
	owner, wid := env.Owner(t)
	other := testenv.Decode[struct {
		ID string `json:"id"`
	}](t, env.Call(t, "POST", "/api/v1/workspaces", owner.AccessToken, map[string]any{"name": "Second"}, 201))
	_, first := invite(t, env, owner, wid, "shared@example.test", "viewer")
	_, second := invite(t, env, owner, other.ID, "shared@example.test", "editor")
	results := make(chan testenv.Result, 2)
	failures := make(chan error, 2)
	var workers sync.WaitGroup
	for _, token := range []string{first.Token, second.Token} {
		workers.Go(func() {
			result, err := env.Do("POST", "/api/v1/invitations/accept", "", joinBody(token))
			results <- result
			failures <- err
		})
	}
	workers.Wait()
	close(results)
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	statuses := map[int]int{}
	for result := range results {
		statuses[result.Status]++
	}
	if statuses[200] != 1 || statuses[401] != 1 {
		t.Fatalf("unexpected concurrent registration outcomes: %v", statuses)
	}
	var count int64
	if err := env.DB.Table("users").Where("email=?", "shared@example.test").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("concurrent invitations created duplicate accounts")
	}
}

func TestInvitationRegistrationRollsBackOnMembershipFailure(t *testing.T) {
	env := testenv.NewWithMail(t)
	owner, wid := env.Owner(t)
	_, message := invite(t, env, owner, wid, "rollback@example.test", "editor")
	if err := env.DB.Exec("ALTER TABLE workspace_members ADD CONSTRAINT reject_test_editor CHECK (role <> 'editor')").Error; err != nil {
		t.Fatal(err)
	}
	env.Call(t, "POST", "/api/v1/invitations/accept", "", joinBody(message.Token), 500)
	var count int64
	if err := env.DB.Table("users").Where("email=?", "rollback@example.test").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("failed acceptance left a new account")
	}
	if err := env.DB.Exec("ALTER TABLE workspace_members DROP CONSTRAINT reject_test_editor").Error; err != nil {
		t.Fatal(err)
	}
	env.Call(t, "POST", "/api/v1/invitations/accept", "", joinBody(message.Token), 200)
}

func TestInvitationExpiryIsCheckedAfterLockWait(t *testing.T) {
	env := testenv.NewWithMail(t)
	owner, wid := env.Owner(t)
	item := testenv.Decode[invitation](t, env.Call(t, "POST", invitationPath(wid), owner.AccessToken, map[string]any{"email": "waiting@example.test", "role": "viewer", "ttl_seconds": 60}, 201))
	message := env.Mail(t, item.ID)
	pool, err := env.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	blocker, err := pool.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = blocker.Rollback() })
	if _, err := blocker.ExecContext(t.Context(), "SELECT id FROM workspaces WHERE id=$1 FOR NO KEY UPDATE", wid); err != nil {
		t.Fatal(err)
	}
	type outcome struct {
		result testenv.Result
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, err := env.Do("POST", "/api/v1/invitations/accept", "", joinBody(message.Token))
		done <- outcome{result: result, err: err}
	}()
	waitForLock(t, env, "%workspaces%FOR NO KEY UPDATE%")
	env.Clock.Advance(time.Minute + time.Millisecond)
	if err := blocker.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-done:
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.result.Code != "INVITATION_EXPIRED" {
			t.Fatal("lock wait allowed an expired invitation")
		}
	case <-t.Context().Done():
		t.Fatal(context.Cause(t.Context()))
	}
}

func TestDisabledMailDoesNotCreateInvitation(t *testing.T) {
	env := testenv.New(t)
	owner, wid := env.Owner(t)
	env.Call(t, "POST", invitationPath(wid), owner.AccessToken, map[string]any{"email": "disabled@example.test", "role": "viewer"}, 503)
	var count int64
	if err := env.DB.Table("workspace_invitations").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("disabled mail persisted an unusable invitation")
	}
}
