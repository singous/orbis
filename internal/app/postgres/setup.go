package postgres

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/identity"
	idstore "orbis.local/orbis/internal/identity/postgres"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/workspace"
)

type Setup struct{ db *gorm.DB }

// NewSetup uses the caller-owned pool for installation transactions.
func NewSetup(db *gorm.DB) *Setup { return &Setup{db: db} }

type installation struct {
	Singleton       bool
	InitializedAtMS *int64 `gorm:"column:initialized_at_ms"`
}

// TableName keeps persisted table names independent of Go type names.
func (installation) TableName() string { return "installation" }

// Initialized reads the singleton marker without side effects.
func (s *Setup) Initialized(ctx context.Context) (bool, error) {
	var row installation
	err := s.db.WithContext(ctx).Take(&row).Error
	return row.InitializedAtMS != nil, err
}

// Initialize locks the singleton before committing the user, membership, and workspace together.
func (s *Setup) Initialize(ctx context.Context, u identity.User, w workspace.Workspace) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row installation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Take(&row).Error; err != nil {
			return err
		}
		if row.InitializedAtMS != nil {
			return fault.New(fault.Conflict, "SETUP_COMPLETED", "系统已完成初始化")
		}
		user := idstore.UserRecord(u)
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		if err := insertWorkspace(
			ctx,
			tx,
			w,
			u.ID,
		); err != nil {
			return err
		}
		return tx.Model(&installation{}).Where("singleton = TRUE").Update("initialized_at_ms", u.CreatedAtMS).Error
	})
}
