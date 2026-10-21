//go:build integration

package identity_test

import (
	"strings"
	"testing"

	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/tests/testenv"
)

func TestConvertedLegacyRefreshRequiresExplicitKeyAndRotatesOnce(t *testing.T) {
	env := testenv.New(t)
	owner, _ := env.Owner(t)
	legacyKey := "synthetic-legacy-refresh-secret"
	raw := strings.Repeat("r", 64)
	if err := env.DB.Table("sessions").Where("token_hash=?", security.Digest(owner.RefreshToken)).Update("token_hash", security.Digest(legacyKey+":"+raw)).Error; err != nil {
		t.Fatal(err)
	}
	env.Call(t, "POST", "/api/v1/auth/refresh", "", map[string]any{"refresh_token": raw}, 401)
	env.UseLegacySecrets(t, "synthetic-wrong-refresh-secret", "")
	env.Call(t, "POST", "/api/v1/auth/refresh", "", map[string]any{"refresh_token": raw}, 401)
	env.UseLegacySecrets(t, legacyKey, "")
	rotated := testenv.Decode[testenv.Session](t, env.Call(t, "POST", "/api/v1/auth/refresh", "", map[string]any{"refresh_token": raw}, 200))
	if len(rotated.RefreshToken) != 43 || rotated.User.ID != owner.User.ID {
		t.Fatal("legacy refresh did not rotate into the current credential format")
	}
	env.Call(t, "POST", "/api/v1/auth/refresh", "", map[string]any{"refresh_token": raw}, 401)
	env.UseLegacySecrets(t, "", "")
	env.Call(t, "POST", "/api/v1/auth/refresh", "", map[string]any{"refresh_token": rotated.RefreshToken}, 200)
}
