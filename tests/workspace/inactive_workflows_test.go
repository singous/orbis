//go:build integration

package workspace_test

import (
	"testing"

	"orbis.local/orbis/tests/testenv"
)

func TestInactiveWorkspaceCannotAcceptPendingInvitation(t *testing.T) {
	env := testenv.NewWithMail(t)
	owner, wid := env.Owner(t)
	invitation, message := invite(t, env, owner, wid, "inactive-space-guest@example.test", "viewer")
	if err := env.DB.Table("workspaces").Where("id=?", wid).Update("is_active", false).Error; err != nil {
		t.Fatal(err)
	}
	env.Call(t, "POST", "/api/v1/invitations/inspect", "", map[string]any{"token": message.Token}, 409)
	env.Call(t, "POST", "/api/v1/invitations/accept", "", joinBody(message.Token), 409)
	var users int64
	if err := env.DB.Table("users").Count(&users).Error; err != nil || users != 1 {
		t.Fatal("disabled workspace invitation created an account")
	}
	var state string
	if err := env.DB.Table("workspace_invitations").Select("status").Where("id=?", invitation.ID).Scan(&state).Error; err != nil || state != "pending" {
		t.Fatal("denied invitation consumed its capability")
	}
}
func TestInactiveOwnershipPartiesCannotConsumePendingTransfer(t *testing.T) {
	for _, reason := range []string{"workspace", "target_account"} {
		t.Run(reason, func(t *testing.T) {
			env, owner, target, wid := ownershipFixture(t)
			transfer, message := createTransfer(t, env, owner, target, wid)
			if reason == "workspace" {
				if err := env.DB.Table("workspaces").Where("id=?", wid).Update("is_active", false).Error; err != nil {
					t.Fatal(err)
				}
			} else {
				if err := env.DB.Table("users").Where("id=?", target.User.ID).Update("is_active", false).Error; err != nil {
					t.Fatal(err)
				}
			}
			env.Call(t, "POST", "/api/v1/ownership-transfers/confirm", "", map[string]any{"token": message.Token}, 409)
			assertRole(t, env, wid, owner.User.ID, "owner")
			assertRole(t, env, wid, target.User.ID, "admin")
			var state string
			if err := env.DB.Table("ownership_transfers").Select("status").Where("id=?", transfer.ID).Scan(&state).Error; err != nil || state != "failed" {
				t.Fatal("invalid pending transfer remained confirmable")
			}
		})
	}
}
