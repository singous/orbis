package identity

import (
	"context"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
)

type PreferenceRepository interface {
	SetWorkspacePreference(context.Context, string, *string, int64) (User, error)
}
type Preferences struct {
	repo  PreferenceRepository
	clock clock.Clock
}

func NewPreferences(repo PreferenceRepository, c clock.Clock) *Preferences {
	return &Preferences{repo: repo, clock: c}
}

// SetWorkspacePreference stores display state; request authorization always uses the explicit resource scope.
func (s *Preferences) SetWorkspacePreference(ctx context.Context, actor Actor, workspaceID *string) (User, error) {
	if workspaceID != nil {
		id, err := uuid.Parse(*workspaceID)
		if err != nil || id == uuid.Nil || id.String() != *workspaceID {
			return User{}, fault.Field("body.workspace_id", "工作空间 ID 必须是标准 UUID 或 null")
		}
	}
	return s.repo.SetWorkspacePreference(ctx, actor.UserID, workspaceID, s.clock.Now().UnixMilli())
}
