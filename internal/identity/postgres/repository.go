package postgres

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"orbis.local/orbis/internal/platform/clock"

	"orbis.local/orbis/internal/identity"
	"orbis.local/orbis/internal/platform/fault"
)

type Repository struct{ db *gorm.DB }

// New maps identity persistence through a caller-owned database pool.
func New(db *gorm.DB) *Repository { return &Repository{db: db} }

type UserRow struct {
	PreferredWorkspaceID *string
	IsActive             bool `gorm:"default:true"`
	AvatarAssetID        *string
	ID                   string
	Email                string
	PasswordHash         string
	DisplayName          *string
	Bio                  *string
	ProfileVersion       int64 `gorm:"default:1"`
	CreatedAtMS          int64 `gorm:"column:created_at_ms"`
	UpdatedAtMS          int64 `gorm:"column:updated_at_ms"`
}

// TableName keeps persisted table names independent of Go type names.
func (UserRow) TableName() string { return "users" }

// UserRecord makes the storage representation available to atomic installation orchestration.
func UserRecord(u identity.User) UserRow {
	return UserRow{
		ID:                   u.ID,
		PreferredWorkspaceID: u.PreferredWorkspaceID,
		AvatarAssetID:        u.AvatarAssetID,
		Email:                u.Email,
		PasswordHash:         u.PasswordHash,
		DisplayName:          u.DisplayName, Bio: u.Bio, ProfileVersion: u.ProfileVersion,
		CreatedAtMS: u.CreatedAtMS,
		UpdatedAtMS: u.UpdatedAtMS,
	}
}
func (r UserRow) domain() identity.User {
	return identity.User{
		ID:                   r.ID,
		PreferredWorkspaceID: r.PreferredWorkspaceID,
		AvatarAssetID:        r.AvatarAssetID,
		Email:                r.Email,
		PasswordHash:         r.PasswordHash,
		DisplayName:          r.DisplayName, Bio: r.Bio, ProfileVersion: r.ProfileVersion,
		CreatedAtMS: r.CreatedAtMS,
		UpdatedAtMS: r.UpdatedAtMS,
	}
}

type sessionRow struct {
	ID, UserID, TokenHash string
	ExpiresAtMS           int64  `gorm:"column:expires_at_ms"`
	RevokedAtMS           *int64 `gorm:"column:revoked_at_ms"`
	CreatedAtMS           int64  `gorm:"column:created_at_ms"`
	UpdatedAtMS           int64  `gorm:"column:updated_at_ms"`
}

// TableName keeps persisted table names independent of Go type names.
func (sessionRow) TableName() string { return "sessions" }
func (r sessionRow) domain() identity.Session {
	return identity.Session{
		ID:          r.ID,
		UserID:      r.UserID,
		TokenHash:   r.TokenHash,
		ExpiresAtMS: r.ExpiresAtMS,
		RevokedAtMS: r.RevokedAtMS,
		CreatedAtMS: r.CreatedAtMS,
		UpdatedAtMS: r.UpdatedAtMS,
	}
}

// FindUser translates a missing account into the domain sentinel.
func (r *Repository) FindUser(ctx context.Context, id string) (identity.User, error) {
	var u UserRow
	err := r.db.WithContext(ctx).Where("id = ? AND is_active", id).Take(&u).Error
	return u.domain(), lookupError(err)
}

// FindUserByEmail expects an already normalized email address.
func (r *Repository) FindUserByEmail(ctx context.Context, email string) (identity.User, error) {
	var u UserRow
	err := r.db.WithContext(ctx).Where("email = ? AND is_active", email).Take(&u).Error
	return u.domain(), lookupError(err)
}

// CreateSession persists only the refresh credential digest.
func (r *Repository) CreateSession(ctx context.Context, s identity.Session) error {
	return r.db.WithContext(ctx).Create(&sessionRow{
		ID:          s.ID,
		UserID:      s.UserID,
		TokenHash:   s.TokenHash,
		ExpiresAtMS: s.ExpiresAtMS,
		RevokedAtMS: s.RevokedAtMS,
		CreatedAtMS: s.CreatedAtMS,
		UpdatedAtMS: s.UpdatedAtMS,
	}).Error
}

// FindSession returns current revocation and expiry state for access-token checks.
func (r *Repository) FindSession(ctx context.Context, id string) (identity.Session, error) {
	var s sessionRow
	err := r.db.WithContext(ctx).Table("sessions s").Select("s.*").Joins("JOIN users u ON u.id=s.user_id AND u.is_active").Where("s.id = ?", id).Take(&s).Error
	return s.domain(), lookupError(err)
}

// FindSessionByHash resolves refresh credentials without storing their plaintext.
func (r *Repository) FindSessionByHash(ctx context.Context, hash string) (identity.Session, error) {
	var s sessionRow
	err := r.db.WithContext(ctx).Table("sessions s").Select("s.*").Joins("JOIN users u ON u.id=s.user_id AND u.is_active").Where("s.token_hash = ?", hash).Take(&s).Error
	return s.domain(), lookupError(err)
}
func lookupError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return identity.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("query identity record: %w", err)
	}
	return nil
}

// RotateSession atomically replaces an unrevoked, unexpired refresh digest.
func (r *Repository) RotateSession(ctx context.Context, id, previous, next string, c clock.Clock) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row sessionRow
		if err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).Where("id=?", id).Take(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return fault.Auth()
			}
			return err
		}
		now := c.Now().UnixMilli()
		result := tx.Model(&sessionRow{}).Where("id=? AND token_hash=? AND revoked_at_ms IS NULL AND expires_at_ms>? AND EXISTS(SELECT 1 FROM users u WHERE u.id=sessions.user_id AND u.is_active)", id, previous, now).Updates(map[string]any{"token_hash": next, "updated_at_ms": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return fault.Auth()
		}
		return nil
	})
}

// RevokeSession only updates a session belonging to the authenticated user.
func (r *Repository) RevokeSession(ctx context.Context, id, user string, now int64) error {
	return r.db.WithContext(ctx).Model(&sessionRow{}).Where("id = ? AND user_id = ? AND revoked_at_ms IS NULL", id, user).Updates(
		map[string]any{"revoked_at_ms": now, "updated_at_ms": now},
	).Error
}
