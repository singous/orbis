//go:build integration

package workspace_test

import (
	"testing"
	"time"

	"orbis.local/orbis/internal/workspace"
	"orbis.local/orbis/tests/testenv"
)

type ownership struct {
	ID            string `json:"id"`
	Status        string `json:"status"`
	FromUserID    string `json:"from_user_id"`
	TargetUserID  string `json:"target_user_id"`
	EmailSent     bool   `json:"email_sent"`
	ConfirmedAtMS *int64 `json:"confirmed_at_ms"`
}

func ownershipPath(wid string) string { return "/api/v1/workspaces/" + wid + "/ownership-transfers" }

func ownershipFixture(t *testing.T) (*testenv.Environment, testenv.Session, testenv.Session, string) {
	t.Helper()
	env := testenv.NewWithMail(t)
	owner, wid := env.Owner(t)
	_, message := invite(t, env, owner, wid, "admin@example.test", "admin")
	admin := testenv.Decode[joined](t, env.Call(t, "POST", "/api/v1/invitations/accept", "", joinBody(message.Token), 200))
	if admin.Session == nil {
		t.Fatal("admin registration did not return a session")
	}
	return env, owner, *admin.Session, wid
}

func createTransfer(t *testing.T, env *testenv.Environment, owner, admin testenv.Session, wid string) (ownership, workspace.ActionMail) {
	t.Helper()
	result := env.Call(t, "POST", ownershipPath(wid), owner.AccessToken, map[string]any{"target_user_id": admin.User.ID}, 201)
	item := testenv.Decode[ownership](t, result)
	if !item.EmailSent {
		t.Fatal("ownership confirmation was not delivered")
	}
	message := env.Mail(t, item.ID)
	if message.Recipient != "owner@example.test" || message.Kind != workspace.OwnershipMail {
		t.Fatal("ownership confirmation must go to the current owner")
	}
	return item, message
}

func assertRole(t *testing.T, env *testenv.Environment, wid, user, role string) {
	t.Helper()
	var actual string
	if err := env.DB.Table("workspace_members").Select("role").Where("workspace_id=? AND user_id=?", wid, user).Scan(&actual).Error; err != nil {
		t.Fatal(err)
	}
	if actual != role {
		t.Fatalf("membership role = %q, want %q", actual, role)
	}
}

func TestOwnershipConfirmationIsSingleUseAndAtomic(t *testing.T) {
	env, owner, admin, wid := ownershipFixture(t)
	env.Call(t, "POST", ownershipPath(wid), admin.AccessToken, map[string]any{"target_user_id": owner.User.ID}, 403)
	item, message := createTransfer(t, env, owner, admin, wid)
	env.Call(t, "GET", ownershipPath(wid)+"/current", owner.AccessToken, nil, 200)
	env.Call(t, "POST", ownershipPath(wid), owner.AccessToken, map[string]any{"target_user_id": admin.User.ID}, 409)
	env.Call(t, "POST", "/api/v1/invitations/inspect", "", map[string]any{"token": message.Token}, 409)
	type outcome struct {
		result testenv.Result
		err    error
	}
	done := make(chan outcome, 2)
	for range 2 {
		go func() {
			result, err := env.Do("POST", "/api/v1/ownership-transfers/confirm", "", map[string]any{"token": message.Token})
			done <- outcome{result: result, err: err}
		}()
	}
	statuses := map[int]int{}
	for range 2 {
		result := <-done
		if result.err != nil {
			t.Fatal(result.err)
		}
		statuses[result.result.Status]++
	}
	if statuses[200] != 1 || statuses[409] != 1 {
		t.Fatalf("unexpected confirmation outcomes: %v", statuses)
	}
	assertRole(t, env, wid, owner.User.ID, "admin")
	assertRole(t, env, wid, admin.User.ID, "owner")
	var state struct {
		Status        string
		ConfirmedAtMS *int64 `gorm:"column:confirmed_at_ms"`
	}
	if err := env.DB.Table("ownership_transfers").Where("id=?", item.ID).Take(&state).Error; err != nil {
		t.Fatal(err)
	}
	if state.Status != "confirmed" || state.ConfirmedAtMS == nil {
		t.Fatal("confirmation receipt was not committed")
	}
	env.Call(t, "GET", ownershipPath(wid)+"/current", owner.AccessToken, nil, 403)
	env.Call(t, "GET", ownershipPath(wid)+"/current", admin.AccessToken, nil, 404)
}

func TestOwnershipResendCancellationAndExpiry(t *testing.T) {
	env, owner, admin, wid := ownershipFixture(t)
	item, old := createTransfer(t, env, owner, admin, wid)
	env.Clock.Advance(time.Minute)
	env.Call(t, "POST", ownershipPath(wid)+"/"+item.ID+"/resend", owner.AccessToken, nil, 200)
	rotated := env.Mail(t, item.ID)
	if rotated.Token == old.Token {
		t.Fatal("ownership resend kept the old token")
	}
	env.Call(t, "POST", "/api/v1/ownership-transfers/confirm", "", map[string]any{"token": old.Token}, 409)
	env.Call(t, "POST", ownershipPath(wid)+"/"+item.ID+"/cancel", owner.AccessToken, nil, 200)
	env.Call(t, "POST", "/api/v1/ownership-transfers/confirm", "", map[string]any{"token": rotated.Token}, 409)
	_, expired := createTransfer(t, env, owner, admin, wid)
	env.Clock.Advance(workspace.OwnershipTTL + time.Millisecond)
	response := env.Call(t, "POST", "/api/v1/ownership-transfers/confirm", "", map[string]any{"token": expired.Token}, 409)
	if response.Code != "OWNERSHIP_TRANSFER_EXPIRED" {
		t.Fatal("expired ownership capability accepted")
	}
	owner = env.Login(t, "owner@example.test")
	env.Call(t, "GET", ownershipPath(wid)+"/current", owner.AccessToken, nil, 404)
	createTransfer(t, env, owner, admin, wid)
	assertRole(t, env, wid, owner.User.ID, "owner")
}

func TestOwnershipTargetChangeInvalidatesConfirmation(t *testing.T) {
	env, owner, admin, wid := ownershipFixture(t)
	item, message := createTransfer(t, env, owner, admin, wid)
	memberPath := "/api/v1/workspaces/" + wid + "/members/" + admin.User.ID
	env.Call(t, "PATCH", memberPath, owner.AccessToken, map[string]any{"role": "editor", "expected_version": 1}, 200)
	env.Call(t, "POST", "/api/v1/ownership-transfers/confirm", "", map[string]any{"token": message.Token}, 409)
	var status string
	if err := env.DB.Table("ownership_transfers").Select("status").Where("id=?", item.ID).Scan(&status).Error; err != nil {
		t.Fatal(err)
	}
	if status != "failed" {
		t.Fatal("invalid target did not terminally invalidate the transfer")
	}
	env.Call(t, "PATCH", memberPath, owner.AccessToken, map[string]any{"role": "admin", "expected_version": 2}, 200)
	env.Call(t, "POST", "/api/v1/ownership-transfers/confirm", "", map[string]any{"token": message.Token}, 409)
	assertRole(t, env, wid, owner.User.ID, "owner")
}

func TestOwnershipFailureRollsBackBothRoles(t *testing.T) {
	env, owner, admin, wid := ownershipFixture(t)
	_, message := createTransfer(t, env, owner, admin, wid)
	if err := env.DB.Exec("ALTER TABLE ownership_transfers ADD CONSTRAINT reject_test_confirmation CHECK (status <> 'confirmed')").Error; err != nil {
		t.Fatal(err)
	}
	env.Call(t, "POST", "/api/v1/ownership-transfers/confirm", "", map[string]any{"token": message.Token}, 500)
	assertRole(t, env, wid, owner.User.ID, "owner")
	assertRole(t, env, wid, admin.User.ID, "admin")
	if err := env.DB.Exec("ALTER TABLE ownership_transfers DROP CONSTRAINT reject_test_confirmation").Error; err != nil {
		t.Fatal(err)
	}
	env.Call(t, "POST", "/api/v1/ownership-transfers/confirm", "", map[string]any{"token": message.Token}, 200)
}

func TestOwnershipExpiryAfterLockWait(t *testing.T) {
	env, owner, admin, wid := ownershipFixture(t)
	_, message := createTransfer(t, env, owner, admin, wid)
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
		result, err := env.Do("POST", "/api/v1/ownership-transfers/confirm", "", map[string]any{"token": message.Token})
		done <- outcome{result: result, err: err}
	}()
	waitForLock(t, env, "%workspaces%FOR NO KEY UPDATE%")
	env.Clock.Advance(workspace.OwnershipTTL + time.Millisecond)
	if err := blocker.Commit(); err != nil {
		t.Fatal(err)
	}
	result := <-done
	if result.err != nil {
		t.Fatal(result.err)
	}
	if result.result.Code != "OWNERSHIP_TRANSFER_EXPIRED" {
		t.Fatal("ownership expiry was checked before rather than after the lock wait")
	}
	assertRole(t, env, wid, owner.User.ID, "owner")
}

func TestCompetingOwnershipRequestsKeepOnePendingTransfer(t *testing.T) {
	env, owner, admin, wid := ownershipFixture(t)
	type outcome struct {
		result testenv.Result
		err    error
	}
	done := make(chan outcome, 2)
	for range 2 {
		go func() {
			result, err := env.Do("POST", ownershipPath(wid), owner.AccessToken, map[string]any{"target_user_id": admin.User.ID})
			done <- outcome{result: result, err: err}
		}()
	}
	statuses := map[int]int{}
	for range 2 {
		result := <-done
		if result.err != nil {
			t.Fatal(result.err)
		}
		statuses[result.result.Status]++
	}
	if statuses[201] != 1 || statuses[409] != 1 {
		t.Fatalf("unexpected competing transfer outcomes: %v", statuses)
	}
}
