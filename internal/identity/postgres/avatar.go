package postgres

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/identity"
	"orbis.local/orbis/internal/platform/fault"
)

// LockProfile coordinates avatar publication with ordinary profile edits in the caller transaction.
func LockProfile(ctx context.Context, tx *gorm.DB, actor string, expected int64) (identity.User, error) {
	var row UserRow
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).Where("id=?", actor).Take(&row).Error; err != nil {
		return identity.User{}, lookupError(err)
	}
	if row.ProfileVersion != expected {
		return identity.User{}, &fault.Error{
			Kind:    fault.Conflict,
			Code:    "PROFILE_VERSION_CONFLICT",
			Message: "个人资料已变化，请刷新后重试",
			Details: map[string]int64{"expected_version": expected, "current_version": row.ProfileVersion},
		}
	}
	if row.ProfileVersion >= identity.MaxProfileVersion {
		return identity.User{}, fault.New(fault.Conflict, "PROFILE_VERSION_EXHAUSTED", "资料版本号已达到上限")
	}
	return row.domain(), nil
}
func SetAvatar(ctx context.Context, tx *gorm.DB, user identity.User, id *string, now int64) (identity.User, error) {
	user.AvatarAssetID = id
	user.ProfileVersion++
	user.UpdatedAtMS = now
	err := tx.WithContext(ctx).Model(&UserRow{}).Where("id=?", user.ID).Updates(map[string]any{"avatar_asset_id": id, "profile_version": user.ProfileVersion, "updated_at_ms": now}).Error
	return user, err
}
