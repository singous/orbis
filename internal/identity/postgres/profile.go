package postgres

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/identity"
	"orbis.local/orbis/internal/platform/fault"
)

// UpdateProfile checks the version under a row lock and never writes authentication fields.
func (r *Repository) UpdateProfile(ctx context.Context, change identity.ProfileChange) (identity.User, error) {
	var row UserRow
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).Where("id = ?", change.UserID).Take(&row).Error; err != nil {
			return lookupError(err)
		}
		if row.ProfileVersion != change.ExpectedVersion {
			return &fault.Error{
				Kind:    fault.Conflict,
				Code:    "PROFILE_VERSION_CONFLICT",
				Message: "个人资料已变化，请刷新后重试",
				Details: map[string]int64{"expected_version": change.ExpectedVersion, "current_version": row.ProfileVersion},
			}
		}
		if row.ProfileVersion >= identity.MaxProfileVersion {
			return fault.New(fault.Conflict, "PROFILE_VERSION_EXHAUSTED", "资料版本号已达到上限")
		}
		updates := map[string]any{"profile_version": row.ProfileVersion + 1, "updated_at_ms": change.Timestamp}
		if change.NameSet {
			row.DisplayName = change.DisplayName
			updates["display_name"] = change.DisplayName
		}
		if change.BioSet {
			row.Bio = change.Bio
			updates["bio"] = change.Bio
		}
		row.ProfileVersion++
		row.UpdatedAtMS = change.Timestamp
		return tx.Model(&UserRow{}).Where("id = ?", row.ID).Updates(updates).Error
	})
	return row.domain(), err
}
