package postgres

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	idstore "orbis.local/orbis/internal/identity/postgres"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/workspace"
)

func ownershipParties(tx *gorm.DB, wid, from, target string) (WorkspaceRow, MemberRow, MemberRow, error) {
	w, err := lockedActionWorkspace(tx, wid)
	if err != nil {
		return w, MemberRow{}, MemberRow{}, err
	}
	rows := []MemberRow{}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("workspace_id=? AND user_id IN ?", wid, []string{from, target}).Order("user_id").Find(&rows).Error; err != nil {
		return w, MemberRow{}, MemberRow{}, err
	}
	var activeIDs []string
	if err := tx.Table("users").Select("id").Where("id IN ? AND is_active", []string{from, target}).Scan(&activeIDs).Error; err != nil {
		return w, MemberRow{}, MemberRow{}, err
	}
	active := map[string]bool{}
	for _, id := range activeIDs {
		active[id] = true
	}
	var owner, recipient MemberRow
	for _, row := range rows {
		if !w.IsActive || !active[row.UserID] {
			continue
		}
		if row.UserID == from {
			owner = row
		}
		if row.UserID == target {
			recipient = row
		}
	}
	return w, owner, recipient, nil
}

func transferDetails(ctx context.Context, tx *gorm.DB, row transferRow, name string, now int64) (workspace.OwnershipTransfer, error) {
	result := row.domain(now)
	result.WorkspaceName = name
	accounts := idstore.New(tx)
	owner, err := accounts.FindUser(ctx, row.FromUserID)
	if err != nil {
		return result, err
	}
	target, err := accounts.FindUser(ctx, row.TargetUserID)
	if err != nil {
		return result, err
	}
	result.Recipient = owner.Email
	result.TargetDisplayName = target.Name()
	return result, nil
}

// CurrentTransfer returns no record once the capability expires, without mutating during a read.
func (r *ActionStore) CurrentTransfer(ctx context.Context, scope workspace.ActionScope) (workspace.OwnershipTransfer, error) {
	var row transferRow
	now := r.clock.Now().UnixMilli()
	err := r.db.WithContext(ctx).Where("workspace_id=? AND from_user_id=? AND status='pending' AND expires_at_ms>?", scope.WorkspaceID, scope.ActorID, now).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return workspace.OwnershipTransfer{}, fault.Missing()
	}
	if err != nil {
		return workspace.OwnershipTransfer{}, err
	}
	return row.domain(now), nil
}

// CreateTransfer holds the membership-management gate and permits one live request per workspace.
func (r *ActionStore) CreateTransfer(ctx context.Context, input workspace.OwnershipCreate) (workspace.OwnershipTransfer, error) {
	var result workspace.OwnershipTransfer
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		w, owner, target, err := ownershipParties(tx, input.Scope.WorkspaceID, input.Scope.ActorID, input.TargetUserID)
		if err != nil {
			return err
		}
		if owner.Role != "owner" {
			return fault.Denied()
		}
		if target.Role != "admin" {
			return fault.New(fault.Conflict, "OWNERSHIP_TARGET_INVALID", "目标必须是当前工作空间的管理员")
		}
		now := r.clock.Now()
		timestamp := now.UnixMilli()
		if err := tx.Model(&transferRow{}).Where("workspace_id=? AND status='pending' AND expires_at_ms<=?", w.ID, timestamp).
			Updates(map[string]any{"status": "expired", "updated_at_ms": timestamp}).Error; err != nil {
			return err
		}
		var pending int64
		if err := tx.Model(&transferRow{}).Where("workspace_id=? AND status='pending'", w.ID).Count(&pending).Error; err != nil {
			return err
		}
		if pending != 0 {
			return fault.New(fault.Conflict, "OWNERSHIP_TRANSFER_PENDING", "已有待确认的所有权转移")
		}
		row := transferRow{ID: input.ID, WorkspaceID: w.ID, FromUserID: owner.UserID, TargetUserID: target.UserID,
			TokenHash: input.TokenHash, Status: "pending", ExpiresAtMS: now.Add(workspace.OwnershipTTL).UnixMilli(), CreatedAtMS: timestamp, UpdatedAtMS: timestamp}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		result, err = transferDetails(ctx, tx, row, w.Name, timestamp)
		return err
	})
	return result, err
}

func transferByScope(tx *gorm.DB, scope workspace.ActionScope, lock bool) (transferRow, error) {
	query := tx.Where("id=? AND workspace_id=? AND from_user_id=?", scope.ActionID, scope.WorkspaceID, scope.ActorID)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var row transferRow
	err := query.Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return row, fault.Missing()
	}
	return row, err
}

// RotateTransfer invalidates the old confirmation only while both owner and target remain eligible.
func (r *ActionStore) RotateTransfer(ctx context.Context, rotation workspace.ActionRotation) (workspace.OwnershipTransfer, error) {
	var result workspace.OwnershipTransfer
	hint, err := transferByScope(r.db.WithContext(ctx), rotation.Scope, false)
	if err != nil {
		return result, err
	}
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		w, owner, target, err := ownershipParties(tx, hint.WorkspaceID, hint.FromUserID, hint.TargetUserID)
		if err != nil {
			return err
		}
		if owner.Role != "owner" {
			return fault.Denied()
		}
		if target.Role != "admin" {
			return fault.New(fault.Conflict, "OWNERSHIP_TARGET_INVALID", "目标已不是管理员，请取消后重新发起")
		}
		row, err := transferByScope(tx, rotation.Scope, true)
		if err != nil {
			return err
		}
		now := r.clock.Now()
		timestamp := now.UnixMilli()
		if err := transferState(row, timestamp); err != nil {
			return err
		}
		row.TokenHash = rotation.TokenHash
		row.ExpiresAtMS = now.Add(workspace.OwnershipTTL).UnixMilli()
		row.EmailSent = false
		row.EmailErrorSummary = nil
		row.UpdatedAtMS = timestamp
		if err := tx.Model(&transferRow{}).Where("id=?", row.ID).Updates(map[string]any{
			"token_hash": row.TokenHash, "expires_at_ms": row.ExpiresAtMS, "email_sent": false, "email_error_summary": nil, "updated_at_ms": timestamp,
		}).Error; err != nil {
			return err
		}
		result, err = transferDetails(ctx, tx, row, w.Name, timestamp)
		return err
	})
	return result, err
}

// CancelTransfer serializes against confirmation and leaves both membership roles unchanged.
func (r *ActionStore) CancelTransfer(ctx context.Context, scope workspace.ActionScope) (workspace.OwnershipTransfer, error) {
	var result workspace.OwnershipTransfer
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, _, err := actionActor(tx, scope, workspace.TransferOwnership); err != nil {
			return err
		}
		row, err := transferByScope(tx, scope, true)
		if err != nil {
			return err
		}
		now := r.clock.Now().UnixMilli()
		if err := transferState(row, now); err != nil {
			return err
		}
		if err := tx.Model(&transferRow{}).Where("id=?", row.ID).Updates(map[string]any{"status": "cancelled", "cancelled_at_ms": now, "updated_at_ms": now}).Error; err != nil {
			return err
		}
		row.Status = "cancelled"
		row.CancelledAtMS = &now
		row.UpdatedAtMS = now
		result = row.domain(now)
		return nil
	})
	return result, err
}

// ConfirmTransfer consumes the email capability with an atomic owner downgrade and target promotion.
func (r *ActionStore) ConfirmTransfer(ctx context.Context, hash string) (workspace.OwnershipTransfer, error) {
	var result workspace.OwnershipTransfer
	var hint transferRow
	if err := r.db.WithContext(ctx).Where("token_hash=?", hash).Take(&hint).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return result, transferInvalid()
		}
		return result, err
	}
	var terminalError error
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, owner, target, err := ownershipParties(tx, hint.WorkspaceID, hint.FromUserID, hint.TargetUserID)
		if err != nil {
			return err
		}
		var row transferRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND token_hash=?", hint.ID, hash).Take(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return transferInvalid()
			}
			return err
		}
		now := r.clock.Now().UnixMilli()
		if err := transferState(row, now); err != nil {
			return err
		}
		if owner.Role != "owner" || target.Role != "admin" || owner.Version >= maxVersion || target.Version >= maxVersion {
			if err := tx.Model(&transferRow{}).Where("id=?", row.ID).Updates(map[string]any{"status": "failed", "updated_at_ms": now}).Error; err != nil {
				return err
			}
			terminalError = transferInvalid()
			return nil
		}
		// The unique owner index requires demotion before promotion in the same transaction.
		if err := tx.Model(&MemberRow{}).Where("workspace_id=? AND user_id=?", row.WorkspaceID, row.FromUserID).
			Updates(map[string]any{"role": "admin", "version": owner.Version + 1, "updated_at_ms": now}).Error; err != nil {
			return err
		}
		if err := tx.Model(&MemberRow{}).Where("workspace_id=? AND user_id=?", row.WorkspaceID, row.TargetUserID).
			Updates(map[string]any{"role": "owner", "version": target.Version + 1, "updated_at_ms": now}).Error; err != nil {
			return err
		}
		if err := tx.Model(&WorkspaceRow{}).Where("id=?", row.WorkspaceID).Update("updated_at_ms", now).Error; err != nil {
			return err
		}
		if err := tx.Model(&transferRow{}).Where("id=?", row.ID).Updates(map[string]any{"status": "confirmed", "confirmed_at_ms": now, "updated_at_ms": now}).Error; err != nil {
			return err
		}
		row.Status = "confirmed"
		row.ConfirmedAtMS = &now
		row.UpdatedAtMS = now
		result = row.domain(now)
		return nil
	})
	if err != nil {
		return result, err
	}
	return result, terminalError
}

const maxVersion int64 = 1<<53 - 1
