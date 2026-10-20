//go:build integration

package workspace_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"orbis.local/orbis/tests/testenv"
)

func legacyActionDigest(key, token string) string {
	hash := hmac.New(sha256.New, []byte(key))
	hash.Write([]byte(token))
	return hex.EncodeToString(hash.Sum(nil))
}
func TestConvertedLegacyActionsRetainSingleUseAndRoleChecks(t *testing.T) {
	env := testenv.NewWithMail(t)
	owner, wid := env.Owner(t)
	guest := env.AddUser(t, "legacy-guest@example.test")
	base := "/api/v1/workspaces/" + wid
	invite := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/invitations", owner.AccessToken, map[string]any{"email": "legacy-guest@example.test", "role": "admin"}, 201))
	key := "synthetic-legacy-action-secret"
	raw := strings.Repeat("i", 64)
	if err := env.DB.Table("workspace_invitations").Where("id=?", invite.ID).Update("token_hash", legacyActionDigest(key, raw)).Error; err != nil {
		t.Fatal(err)
	}
	env.Call(t, "POST", "/api/v1/invitations/inspect", "", map[string]any{"token": raw}, 409)
	env.UseLegacySecrets(t, "", key)
	env.Call(t, "POST", "/api/v1/invitations/inspect", "", map[string]any{"token": raw}, 200)
	env.Call(t, "POST", "/api/v1/invitations/accept", guest.AccessToken, map[string]any{"token": raw}, 200)
	env.Call(t, "POST", "/api/v1/invitations/accept", guest.AccessToken, map[string]any{"token": raw}, 409)
	transfer := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/ownership-transfers", owner.AccessToken, map[string]any{"target_user_id": guest.User.ID}, 201))
	confirmation := strings.Repeat("o", 64)
	if err := env.DB.Table("ownership_transfers").Where("id=?", transfer.ID).Update("token_hash", legacyActionDigest(key, confirmation)).Error; err != nil {
		t.Fatal(err)
	}
	env.Call(t, "POST", "/api/v1/ownership-transfers/confirm", "", map[string]any{"token": confirmation}, 200)
	env.Call(t, "POST", "/api/v1/ownership-transfers/confirm", "", map[string]any{"token": confirmation}, 409)
	var role string
	if err := env.DB.Table("workspace_members").Select("role").Where("workspace_id=? AND user_id=?", wid, guest.User.ID).Scan(&role).Error; err != nil || role != "owner" {
		t.Fatal("converted confirmation did not preserve the ownership transaction")
	}
}
