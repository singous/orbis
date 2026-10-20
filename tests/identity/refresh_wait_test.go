//go:build integration

package identity_test

import (
	"testing"
	"time"

	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/tests/testenv"
)

func TestRefreshExpiryIsRecheckedAfterSessionLockWait(t *testing.T) {
	env := testenv.New(t)
	owner, _ := env.Owner(t)
	var id string
	if err := env.DB.Table("sessions").Select("id").Where("token_hash=?", security.Digest(owner.RefreshToken)).Scan(&id).Error; err != nil || id == "" {
		t.Fatal("synthetic session missing")
	}
	tx := env.DB.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	defer tx.Rollback()
	if err := tx.Exec("SELECT id FROM sessions WHERE id=? FOR NO KEY UPDATE", id).Error; err != nil {
		t.Fatal(err)
	}
	type response struct {
		result testenv.Result
		err    error
	}
	finished := make(chan response, 1)
	go func() {
		value, err := env.Do("POST", "/api/v1/auth/refresh", "", map[string]any{"refresh_token": owner.RefreshToken})
		finished <- response{value, err}
	}()
	deadline := time.Now().Add(5 * time.Second)
	blocked := false
	for time.Now().Before(deadline) {
		var count int64
		if err := env.DB.Raw("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'").Scan(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count > 0 {
			blocked = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !blocked {
		t.Fatal("refresh did not wait on the session lock")
	}
	env.Clock.Advance(25 * time.Hour)
	if err := tx.Commit().Error; err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-finished:
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.result.Status != 401 {
			t.Fatalf("expired waiter rotated a session: %d", result.result.Status)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("refresh waiter remained blocked")
	}
	var hash string
	if err := env.DB.Table("sessions").Select("token_hash").Where("id=?", id).Scan(&hash).Error; err != nil || hash != security.Digest(owner.RefreshToken) {
		t.Fatal("expired refresh changed the credential")
	}
}
