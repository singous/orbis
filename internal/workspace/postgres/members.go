package postgres

import (
	"context"
	"database/sql"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/identity"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/workspace"
)

type memberDetails struct {
	MemberRow
	Email       string
	DisplayName *string
}

func (row memberDetails) domain() workspace.Member {
	return workspace.Member{
		WorkspaceID: row.WorkspaceID, UserID: row.UserID,
		Email: row.Email, DisplayName: (identity.User{DisplayName: row.DisplayName}).Name(), Role: row.Role,
		Version: row.Version, CreatedAtMS: row.CreatedAtMS, UpdatedAtMS: row.UpdatedAtMS,
	}
}

// Members counts and reads the same authorized snapshot without exposing password fields.
func (r *Repository) Members(
	ctx context.Context,
	scope workspace.MemberScope,
	page pagination.Page,
) ([]workspace.Member, int64, error) {
	items := []workspace.Member{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := tx.Table("workspace_members AS m").Joins("JOIN users AS u ON u.id = m.user_id").Where(
			"m.workspace_id = ? AND EXISTS (SELECT 1 FROM workspace_members a WHERE a.workspace_id = m.workspace_id AND a.user_id = ?)",
			scope.WorkspaceID, scope.ActorID,
		)
		if err := query.Count(&total).Error; err != nil {
			return err
		}
		rows := []memberDetails{}
		if err := query.Select("m.*, u.email, u.display_name").Order("m.created_at_ms, m.user_id").
			Offset(page.Offset()).Limit(page.Size).Scan(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			items = append(items, row.domain())
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return items, total, err
}

// lockMemberChange serializes management while remaining compatible with foreign-key KEY SHARE locks.
func lockMemberChange(tx *gorm.DB, change workspace.MemberChange) (MemberRow, MemberRow, error) {
	var w WorkspaceRow
	if err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).
		Where("id = ?", change.Scope.WorkspaceID).Take(&w).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return MemberRow{}, MemberRow{}, fault.Missing()
		}
		return MemberRow{}, MemberRow{}, err
	}
	rows := []MemberRow{}
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
		"workspace_id = ? AND user_id IN ?", change.Scope.WorkspaceID,
		[]string{change.Scope.ActorID, change.UserID},
	).Order("user_id").Find(&rows).Error
	if err != nil {
		return MemberRow{}, MemberRow{}, err
	}
	var actor, target MemberRow
	for _, row := range rows {
		if row.UserID == change.Scope.ActorID {
			actor = row
		}
		if row.UserID == change.UserID {
			target = row
		}
	}
	if actor.UserID == "" || target.UserID == "" {
		return actor, target, fault.Missing()
	}
	return actor, target, nil
}

func authorizeMemberChange(actor, target MemberRow, change workspace.MemberChange, removing bool) error {
	if target.Role == "owner" {
		return fault.New(fault.Conflict, "OWNER_PROTECTED", "所有者需要先完成所有权转移")
	}
	selfRemoval := removing && actor.UserID == target.UserID
	if !selfRemoval && !workspace.CanManageMember(actor.Role, target.Role, change.Role) {
		return fault.Denied()
	}
	if target.Version != change.ExpectedVersion {
		return &fault.Error{
			Kind: fault.Conflict, Code: "MEMBER_VERSION_CONFLICT", Message: "成员状态已变化，请刷新后重试",
			Details: map[string]int64{"expected_version": change.ExpectedVersion, "current_version": target.Version},
		}
	}
	return nil
}

// ChangeMember rechecks actor and target roles while both membership rows are locked.
func (r *Repository) ChangeMember(
	ctx context.Context,
	change workspace.MemberChange,
) (workspace.Member, error) {
	var result workspace.Member
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		actor, target, err := lockMemberChange(tx, change)
		if err != nil {
			return err
		}
		if err := authorizeMemberChange(
			actor,
			target,
			change,
			false,
		); err != nil {
			return err
		}
		if target.Role != change.Role {
			if err := tx.Model(&MemberRow{}).Where("workspace_id = ? AND user_id = ?", change.Scope.WorkspaceID, change.UserID).
				Updates(map[string]any{"role": change.Role, "version": target.Version + 1, "updated_at_ms": change.Timestamp}).Error; err != nil {
				return err
			}
		}
		var row memberDetails
		if err := tx.Table("workspace_members m").Select("m.*, u.email, u.display_name").
			Joins("JOIN users u ON u.id = m.user_id").Where("m.workspace_id = ? AND m.user_id = ?", change.Scope.WorkspaceID, change.UserID).
			Take(&row).Error; err != nil {
			return err
		}
		result = row.domain()
		return nil
	})
	return result, err
}

// RemoveMember deletes only membership; user identity, sessions, and authored history remain intact.
func (r *Repository) RemoveMember(ctx context.Context, change workspace.MemberChange) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		actor, target, err := lockMemberChange(tx, change)
		if err != nil {
			return err
		}
		if err := authorizeMemberChange(
			actor,
			target,
			change,
			true,
		); err != nil {
			return err
		}
		return tx.Where("workspace_id = ? AND user_id = ?", change.Scope.WorkspaceID, change.UserID).Delete(&MemberRow{}).Error
	})
}
