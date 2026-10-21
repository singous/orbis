package postgres

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"orbis.local/orbis/internal/identity"
	idstore "orbis.local/orbis/internal/identity/postgres"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type Preferences struct{ db *gorm.DB }

func NewPreferences(db *gorm.DB) *Preferences { return &Preferences{db: db} }
func (r *Preferences) SetWorkspacePreference(ctx context.Context, userID string, wid *string, timestamp int64) (identity.User, error) {
	var row idstore.UserRow
	var result identity.User
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).Where("id=? AND is_active", userID).Take(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return fault.Auth()
			}
			return err
		}
		if wid != nil {
			if err := wsstore.RequireLocked(ctx, tx, *wid, userID, workspace.Read); err != nil {
				return err
			}
		}
		row.PreferredWorkspaceID = wid
		row.UpdatedAtMS = timestamp
		if err := tx.Model(&idstore.UserRow{}).Where("id=?", row.ID).Updates(map[string]any{"preferred_workspace_id": wid, "updated_at_ms": timestamp}).Error; err != nil {
			return err
		}
		var err error
		result, err = idstore.New(tx).FindUser(ctx, row.ID)
		return err
	})
	return result, err
}
