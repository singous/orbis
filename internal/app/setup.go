package app

import (
	"context"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/identity"
	"orbis.local/orbis/internal/workspace"
)

type SetupStore interface {
	Initialized(context.Context) (bool, error)
	Initialize(context.Context, identity.User, workspace.Workspace) error
}
type Setup struct {
	store    SetupStore
	identity *identity.Service
}

// NewSetup binds installation orchestration to its atomic persistence boundary.
func NewSetup(store SetupStore, id *identity.Service) *Setup {
	return &Setup{store: store, identity: id}
}

// Status reads installation state without creating an account.
func (s *Setup) Status(ctx context.Context) (bool, error) { return s.store.Initialized(ctx) }

// Initialize creates the first owner and workspace atomically; a second attempt conflicts.
func (s *Setup) Initialize(
	ctx context.Context,
	email, password, name, workspaceName string,
) (identity.User, workspace.Workspace, error) {
	workspaceName, err := workspace.ValidName(workspaceName)
	if err != nil {
		return identity.User{}, workspace.Workspace{}, err
	}
	u, err := s.identity.PrepareUser(
		ctx,
		email,
		password,
		name,
	)
	if err != nil {
		return u, workspace.Workspace{}, err
	}
	w := workspace.Workspace{
		ID:          uuid.NewString(),
		Name:        workspaceName,
		Role:        "owner",
		CreatedAtMS: u.CreatedAtMS,
		UpdatedAtMS: u.CreatedAtMS,
	}
	return u, w, s.store.Initialize(ctx, u, w)
}
