package postgres

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/workspace"
)

type Repository struct{ db *gorm.DB }

// New uses the caller-owned pool for workspace storage.
func New(db *gorm.DB) *Repository { return &Repository{db: db} }

type WorkspaceRow struct {
	IsActive    bool `gorm:"default:true"`
	ID, Name    string
	CreatedAtMS int64 `gorm:"column:created_at_ms"`
	UpdatedAtMS int64 `gorm:"column:updated_at_ms"`
}

// TableName keeps persisted table names independent of Go type names.
func (WorkspaceRow) TableName() string { return "workspaces" }

type MemberRow struct {
	WorkspaceID, UserID, Role string
	Version                   int64 `gorm:"default:1"`
	CreatedAtMS               int64 `gorm:"column:created_at_ms"`
	UpdatedAtMS               int64 `gorm:"column:updated_at_ms"`
}

// TableName keeps persisted table names independent of Go type names.
func (MemberRow) TableName() string { return "workspace_members" }

// Insert joins the caller transaction so bootstrap and ordinary creation share the same invariant.
func Insert(ctx context.Context, tx *gorm.DB, w workspace.Workspace, actor string) error {
	if err := tx.WithContext(ctx).Create(
		&WorkspaceRow{ID: w.ID, Name: w.Name, CreatedAtMS: w.CreatedAtMS, UpdatedAtMS: w.UpdatedAtMS},
	).Error; err != nil {
		return err
	}
	return tx.WithContext(ctx).Create(&MemberRow{
		WorkspaceID: w.ID,
		UserID:      actor,
		Role:        "owner",
		CreatedAtMS: w.CreatedAtMS,
		UpdatedAtMS: w.UpdatedAtMS,
	}).Error
}

// Role distinguishes missing membership from infrastructure failures.
func (r *Repository) Role(ctx context.Context, wid, actor string) (string, error) {
	var m MemberRow
	err := r.db.WithContext(ctx).Select("workspace_members.*").Joins("JOIN workspaces w ON w.id=workspace_members.workspace_id AND w.is_active").Joins("JOIN users u ON u.id=workspace_members.user_id AND u.is_active").Where("workspace_members.workspace_id = ? AND workspace_members.user_id = ?", wid, actor).Take(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", fault.Missing()
	}
	return m.Role, err
}

// RequireLocked holds membership stable until the caller's transaction commits.
func RequireLocked(ctx context.Context, tx *gorm.DB, wid, actor string, permission workspace.Permission) error {
	var m MemberRow
	err := tx.WithContext(ctx).Select("workspace_members.*").Joins("JOIN workspaces w ON w.id=workspace_members.workspace_id AND w.is_active").Joins("JOIN users u ON u.id=workspace_members.user_id AND u.is_active").Clauses(clause.Locking{Strength: "SHARE", Table: clause.Table{Name: "workspace_members"}}).Where(
		"workspace_members.workspace_id = ? AND workspace_members.user_id = ?",
		wid,
		actor,
	).Take(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fault.Missing()
	}
	if err != nil {
		return err
	}
	if !workspace.Allowed(m.Role, permission) {
		return fault.Denied()
	}
	return nil
}

// List joins membership before counting and paginating workspaces.
func (r *Repository) List(
	ctx context.Context,
	actor string,
	p pagination.Page,
) ([]workspace.Workspace, int64, error) {
	query := r.db.WithContext(ctx).Table("workspaces w").Joins("JOIN workspace_members m ON m.workspace_id = w.id").Where(
		"m.user_id = ? AND w.is_active",
		actor,
	)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []struct {
		WorkspaceRow
		Role string
	}
	err := query.Select("w.*, m.role").Order("w.created_at_ms DESC, w.id DESC").Offset(p.Offset()).Limit(p.Size).Scan(
		&rows,
	).Error
	items := make([]workspace.Workspace, 0, len(rows))
	for _, v := range rows {
		items = append(items, workspace.Workspace{
			ID:          v.ID,
			Name:        v.Name,
			Role:        v.Role,
			CreatedAtMS: v.CreatedAtMS,
			UpdatedAtMS: v.UpdatedAtMS,
		})
	}
	return items, total, err
}
