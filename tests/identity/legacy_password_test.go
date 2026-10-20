//go:build integration

package identity_test

import (
	"strings"
	"testing"

	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/tests/testenv"
)

func TestLegacyUnicodePasswordRangeRemainsUsable(t *testing.T) {
	env := testenv.New(t)
	owner, _ := env.Owner(t)
	password := strings.Repeat("密", 256)
	hash, err := security.NewPasswords().Hash(t.Context(), password)
	if err != nil {
		t.Fatal(err)
	}
	if err := env.DB.Table("users").Where("id=?", owner.User.ID).Update("password_hash", hash).Error; err != nil {
		t.Fatal(err)
	}
	result := testenv.Decode[testenv.Session](t, env.Call(t, "POST", "/api/v1/auth/login", "", map[string]any{"email": "owner@example.test", "password": password}, 200))
	if result.User.ID != owner.User.ID {
		t.Fatal("legacy password did not authenticate the same account")
	}
	env.Call(t, "POST", "/api/v1/auth/login", "", map[string]any{"email": "owner@example.test", "password": strings.Repeat("密", 257)}, 422)
}
