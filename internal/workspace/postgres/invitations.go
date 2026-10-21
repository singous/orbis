package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/identity"
	idstore "orbis.local/orbis/internal/identity/postgres"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/workspace"
)

// Invitations returns one consistent, permission-filtered page without capability hashes.
func (r *ActionStore) Invitations(ctx context.Context, scope workspace.ActionScope, page pagination.Page, now int64) ([]workspace.Invitation, int64, error) {
	items := []workspace.Invitation{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := tx.Table("workspace_invitations i").Joins("JOIN workspaces w ON w.id = i.workspace_id").Where(
			"i.workspace_id = ? AND EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id=i.workspace_id AND m.user_id=? AND m.role IN ('owner','admin'))", scope.WorkspaceID, scope.ActorID)
		if err := query.Count(&total).Error; err != nil {
			return err
		}
		rows := []invitationDetails{}
		if err := query.Select("i.*, w.name AS workspace_name").Order("i.created_at_ms DESC, i.id DESC").Offset(page.Offset()).Limit(page.Size).Scan(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			items = append(items, row.Record.domain(row.WorkspaceName, now))
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return items, total, err
}

// CreateInvitation replaces only pending invitations after checking current inviter privileges.
func (r *ActionStore) CreateInvitation(ctx context.Context, command workspace.InvitationWrite) (workspace.Invitation, error) {
	var result workspace.Invitation
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		w, actor, err := actionActor(tx, command.Input.Scope, workspace.ManageMembers)
		if err != nil {
			return err
		}
		if !workspace.CanManageMember(actor.Role, "viewer", command.Input.Role) {
			return fault.Denied()
		}
		var existing int64
		if err := tx.Table("workspace_members m").Joins("JOIN users u ON u.id=m.user_id").Where("m.workspace_id=? AND u.email=?", w.ID, command.Input.Email).Count(&existing).Error; err != nil {
			return err
		}
		if existing != 0 {
			return fault.New(fault.Conflict, "MEMBER_ALREADY_EXISTS", "该账号已是工作空间成员")
		}
		now := r.clock.Now().UnixMilli()
		prior := tx.Model(&invitationRow{}).Where("workspace_id=? AND email=? AND status='pending'", w.ID, command.Input.Email)
		if err := prior.Where("expires_at_ms <= ?", now).Updates(map[string]any{"status": "expired", "updated_at_ms": now}).Error; err != nil {
			return err
		}
		if err := tx.Model(&invitationRow{}).Where("workspace_id=? AND email=? AND status='pending'", w.ID, command.Input.Email).
			Updates(map[string]any{"status": "revoked", "revoked_at_ms": now, "updated_at_ms": now}).Error; err != nil {
			return err
		}
		row := invitationRow{
			ID: command.ID, WorkspaceID: w.ID, Email: command.Input.Email, Role: command.Input.Role, TokenHash: command.TokenHash,
			Status: "pending", InvitedByUserID: actor.UserID, TTLSeconds: command.Input.TTLSeconds,
			ExpiresAtMS: now + command.Input.TTLSeconds*1000, CreatedAtMS: now, UpdatedAtMS: now,
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		result = row.domain(w.Name, now)
		return nil
	})
	return result, err
}

func lockedInvitation(tx *gorm.DB, scope workspace.ActionScope) (invitationRow, error) {
	var row invitationRow
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("workspace_id=? AND id=?", scope.WorkspaceID, scope.ActionID).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return row, fault.Missing()
	}
	return row, err
}

// RotateInvitation checks expiry after waiting for locks and invalidates the previous token atomically.
func (r *ActionStore) RotateInvitation(ctx context.Context, rotation workspace.ActionRotation) (workspace.Invitation, error) {
	var result workspace.Invitation
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		w, actor, err := actionActor(tx, rotation.Scope, workspace.ManageMembers)
		if err != nil {
			return err
		}
		row, err := lockedInvitation(tx, rotation.Scope)
		if err != nil {
			return err
		}
		if !workspace.CanManageMember(actor.Role, row.Role, row.Role) {
			return fault.Denied()
		}
		now := r.clock.Now().UnixMilli()
		if err := inviteState(row, now); err != nil {
			return err
		}
		row.TokenHash = rotation.TokenHash
		row.ExpiresAtMS = now + row.TTLSeconds*1000
		row.EmailSent = false
		row.EmailErrorSummary = nil
		row.UpdatedAtMS = now
		if err := tx.Model(&invitationRow{}).Where("id=?", row.ID).Updates(map[string]any{
			"token_hash": row.TokenHash, "expires_at_ms": row.ExpiresAtMS, "email_sent": false, "email_error_summary": nil, "updated_at_ms": now,
		}).Error; err != nil {
			return err
		}
		result = row.domain(w.Name, now)
		return nil
	})
	return result, err
}

// RevokeInvitation serializes with acceptance and resend through the same workspace gate.
func (r *ActionStore) RevokeInvitation(ctx context.Context, scope workspace.ActionScope) (workspace.Invitation, error) {
	var result workspace.Invitation
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		w, actor, err := actionActor(tx, scope, workspace.ManageMembers)
		if err != nil {
			return err
		}
		row, err := lockedInvitation(tx, scope)
		if err != nil {
			return err
		}
		if !workspace.CanManageMember(actor.Role, row.Role, row.Role) {
			return fault.Denied()
		}
		now := r.clock.Now().UnixMilli()
		if err := inviteState(row, now); err != nil {
			return err
		}
		if err := tx.Model(&invitationRow{}).Where("id=?", row.ID).Updates(map[string]any{"status": "revoked", "revoked_at_ms": now, "updated_at_ms": now}).Error; err != nil {
			return err
		}
		row.Status = "revoked"
		row.RevokedAtMS = &now
		row.UpdatedAtMS = now
		result = row.domain(w.Name, now)
		return nil
	})
	return result, err
}

// InspectInvitation is read-only and reveals account requirements only for an unexpired token.
func (r *ActionStore) InspectInvitation(ctx context.Context, hash string) (workspace.Invitation, error) {
	var row invitationDetails
	err := r.db.WithContext(ctx).Table("workspace_invitations i").Select("i.*, w.name AS workspace_name, u.id AS existing_user_id").
		Joins("JOIN workspaces w ON w.id=i.workspace_id").Joins("LEFT JOIN users u ON u.email=i.email").Where("i.token_hash=? AND w.is_active", hash).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return workspace.Invitation{}, fault.New(fault.Conflict, "INVITATION_INVALID", "邀请无效或已使用")
	}
	if err != nil {
		return workspace.Invitation{}, err
	}
	now := r.clock.Now().UnixMilli()
	if err := inviteState(row.Record, now); err != nil {
		return workspace.Invitation{}, err
	}
	result := row.Record.domain(row.WorkspaceName, now)
	result.ExistingUserID = row.ExistingUserID
	return result, nil
}

// AcceptInvitation commits account creation, membership, session and token consumption together.
func (r *ActionStore) AcceptInvitation(ctx context.Context, input workspace.InvitationAcceptance) (workspace.Acceptance, error) {
	var result workspace.Acceptance
	var hint invitationRow
	if err := r.db.WithContext(ctx).Where("token_hash=?", input.TokenHash).Take(&hint).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return result, fault.New(fault.Conflict, "INVITATION_INVALID", "邀请无效或已使用")
		}
		return result, err
	}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := actionWorkspace(tx, hint.WorkspaceID); err != nil {
			return err
		}
		row, err := lockedInvitation(tx, workspace.ActionScope{WorkspaceID: hint.WorkspaceID, ActionID: hint.ID})
		if err != nil {
			return err
		}
		if row.TokenHash != input.TokenHash {
			return fault.New(fault.Conflict, "INVITATION_INVALID", "邀请链接已失效")
		}
		if err := inviteState(row, r.clock.Now().UnixMilli()); err != nil {
			return err
		}
		var inactive int64
		if err := tx.Table("users").Where("email=? AND NOT is_active", row.Email).Count(&inactive).Error; err != nil {
			return err
		}
		if inactive != 0 {
			return fault.New(fault.Forbidden, "INVITATION_ACCOUNT_DISABLED", "受邀账号已停用，无法接受邀请")
		}
		accounts := idstore.New(tx)
		user, err := accounts.FindUserByEmail(ctx, row.Email)
		newAccount := false
		if errors.Is(err, identity.ErrNotFound) {
			if input.ActorID != "" {
				return fault.New(fault.Forbidden, "INVITATION_ACCOUNT_MISMATCH", "当前账号与邀请邮箱不一致")
			}
			if input.Candidate == nil || input.Session == nil {
				return fault.Field("body", "首次加入需要密码和显示名称")
			}
			if input.Candidate.Email != row.Email || input.Session.UserID != input.Candidate.ID {
				return fmt.Errorf("registration candidate does not match invitation")
			}
			record := idstore.UserRecord(*input.Candidate)
			insert := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "email"}}, DoNothing: true}).Create(&record)
			if insert.Error != nil {
				return insert.Error
			}
			newAccount = insert.RowsAffected == 1
			user, err = accounts.FindUserByEmail(ctx, row.Email)
		}
		if err != nil {
			return err
		}
		if !newAccount && input.ActorID != user.ID {
			if input.ActorID == "" {
				return fault.New(fault.Unauthenticated, "INVITATION_LOGIN_REQUIRED", "请登录受邀邮箱对应的账号")
			}
			return fault.New(fault.Forbidden, "INVITATION_ACCOUNT_MISMATCH", "当前账号与邀请邮箱不一致")
		}
		// The unique email insert may have waited for registration in another workspace.
		now := r.clock.Now().UnixMilli()
		if err := inviteState(row, now); err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&MemberRow{}).Where("workspace_id=? AND user_id=?", row.WorkspaceID, user.ID).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return fault.New(fault.Conflict, "MEMBER_ALREADY_EXISTS", "该账号已是工作空间成员")
		}
		member := MemberRow{WorkspaceID: row.WorkspaceID, UserID: user.ID, Role: row.Role, Version: 1, CreatedAtMS: now, UpdatedAtMS: now}
		if err := tx.Create(&member).Error; err != nil {
			return err
		}
		if newAccount {
			if err := accounts.CreateSession(ctx, *input.Session); err != nil {
				return err
			}
		}
		if err := tx.Model(&invitationRow{}).Where("id=?", row.ID).Updates(map[string]any{
			"status": "accepted", "accepted_by_user_id": user.ID, "accepted_at_ms": now, "updated_at_ms": now,
		}).Error; err != nil {
			return err
		}
		result = workspace.Acceptance{User: user, NewAccount: newAccount, Member: workspace.Member{
			WorkspaceID: row.WorkspaceID, UserID: user.ID, Email: user.Email, DisplayName: user.Name(), Role: row.Role, Version: 1, CreatedAtMS: now, UpdatedAtMS: now,
		}}
		return nil
	})
	return result, err
}

type invitationDetails struct {
	Record         invitationRow `gorm:"embedded"`
	WorkspaceName  string
	ExistingUserID *string
}
