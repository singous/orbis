package workspace

import (
	"context"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
)

const maxMemberVersion int64 = 1<<53 - 1

type Member struct {
	WorkspaceID string
	UserID      string
	Email       string
	DisplayName string
	Role        string
	Version     int64
	CreatedAtMS int64
	UpdatedAtMS int64
}

type MemberScope struct {
	WorkspaceID string
	ActorID     string
}

type MemberChange struct {
	Scope           MemberScope
	UserID          string
	Role            string
	ExpectedVersion int64
	Timestamp       int64
}

// CanManageMember excludes ownership changes and administrator privilege escalation.
func CanManageMember(actorRole, targetRole, requestedRole string) bool {
	if targetRole == "owner" || requestedRole == "owner" {
		return false
	}
	switch actorRole {
	case "owner":
		return true
	case "admin":
		return targetRole != "admin" && requestedRole != "admin"
	default:
		return false
	}
}

// Members exposes only members of a workspace the actor can read.
func (s *Service) Members(
	ctx context.Context,
	scope MemberScope,
	page pagination.Page,
) ([]Member, int64, error) {
	if err := s.Require(
		ctx,
		scope.ActorID,
		scope.WorkspaceID,
		Read,
	); err != nil {
		return nil, 0, err
	}
	return s.repo.Members(ctx, scope, page)
}

// ChangeMember delegates the final permission and version check to the locked write.
func (s *Service) ChangeMember(ctx context.Context, change MemberChange) (Member, error) {
	if err := s.Require(
		ctx,
		change.Scope.ActorID,
		change.Scope.WorkspaceID,
		ManageMembers,
	); err != nil {
		return Member{}, err
	}
	if change.Role != "admin" && change.Role != "editor" && change.Role != "viewer" {
		return Member{}, fault.Field("body.role", "角色必须是 admin、editor 或 viewer")
	}
	if err := validateMemberVersion(change.ExpectedVersion); err != nil {
		return Member{}, err
	}
	change.Timestamp = s.clock.Now().UnixMilli()
	return s.repo.ChangeMember(ctx, change)
}

// RemoveMember preserves the user account and permits non-owners to leave voluntarily.
func (s *Service) RemoveMember(ctx context.Context, change MemberChange) error {
	permission := ManageMembers
	if change.Scope.ActorID == change.UserID {
		permission = Read
	}
	if err := s.Require(
		ctx,
		change.Scope.ActorID,
		change.Scope.WorkspaceID,
		permission,
	); err != nil {
		return err
	}
	if err := validateMemberVersion(change.ExpectedVersion); err != nil {
		return err
	}
	return s.repo.RemoveMember(ctx, change)
}

func validateMemberVersion(version int64) error {
	if version < 1 || version >= maxMemberVersion {
		return fault.Field("body.expected_version", "成员版本号不正确")
	}
	return nil
}
