package postgres

import (
	"context"

	"gorm.io/gorm"

	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

// Workspaces composes workspace persistence with document catalog initialization.
type Workspaces struct {
	*wsstore.Repository
	db *gorm.DB
}

func NewWorkspaces(db *gorm.DB) *Workspaces {
	return &Workspaces{Repository: wsstore.New(db), db: db}
}

func insertWorkspace(ctx context.Context, tx *gorm.DB, w workspace.Workspace, actor string) error {
	if err := wsstore.Insert(ctx, tx, w, actor); err != nil {
		return err
	}
	return docstore.InsertDefaultGroup(ctx, tx, w.ID, w.CreatedAtMS)
}

// Create commits the workspace, owner, and default group using the same transaction.
func (r *Workspaces) Create(ctx context.Context, w workspace.Workspace, actor string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return insertWorkspace(ctx, tx, w, actor)
	})
}
