package workspace

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
)

type Workspace struct {
	ID, Name, Role           string
	CreatedAtMS, UpdatedAtMS int64
}
type Permission string

const Publish Permission = "publish"
const Read Permission = "read"
const Edit Permission = "edit"
const ManageMembers Permission = "members.manage"
const TransferOwnership Permission = "ownership.transfer"

type Repository interface {
	Create(context.Context, Workspace, string) error
	List(context.Context, string, pagination.Page) ([]Workspace, int64, error)
	Role(context.Context, string, string) (string, error)
	Members(context.Context, MemberScope, pagination.Page) ([]Member, int64, error)
	ChangeMember(context.Context, MemberChange) (Member, error)
	RemoveMember(context.Context, MemberChange) error
}
type Service struct {
	repo  Repository
	clock clock.Clock
}

// New binds workspace use cases to persistence and a controllable timestamp source.
func New(repo Repository, c clock.Clock) *Service { return &Service{repo: repo, clock: c} }

// ValidName trims and bounds a workspace name before persistence.
func ValidName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 160 {
		return "", fault.Field("body.name", "名称长度必须在 1 至 160 个字符之间")
	}
	return name, nil
}

// Allowed is the shared role-to-permission policy for services and locked writes.
func Allowed(role string, permission Permission) bool {
	switch role {
	case "owner":
		return permission == Read || permission == Edit || permission == ManageMembers || permission == Publish || permission == TransferOwnership
	case "admin":
		return permission == Read || permission == Edit || permission == ManageMembers || permission == Publish
	case "editor":
		return permission == Read || permission == Edit
	case "viewer":
		return permission == Read
	}
	return false
}

// Require hides membership absence and rejects insufficient role capabilities.
func (s *Service) Require(ctx context.Context, actor, workspaceID string, permission Permission) error {
	role, err := s.repo.Role(ctx, workspaceID, actor)
	if err != nil {
		return err
	}
	if !Allowed(role, permission) {
		return fault.Denied()
	}
	return nil
}

// Create commits a workspace and its owner membership together.
func (s *Service) Create(ctx context.Context, actor, name string) (Workspace, error) {
	name, err := ValidName(name)
	if err != nil {
		return Workspace{}, err
	}
	now := s.clock.Now().UnixMilli()
	w := Workspace{ID: uuid.NewString(), Name: name, Role: "owner", CreatedAtMS: now, UpdatedAtMS: now}
	return w, s.repo.Create(ctx, w, actor)
}

// List returns only workspaces in which the actor holds membership.
func (s *Service) List(ctx context.Context, actor string, page pagination.Page) ([]Workspace, int64, error) {
	return s.repo.List(ctx, actor, page)
}
