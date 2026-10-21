package postgres

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/workspace"
)

type ActionStore struct {
	db    *gorm.DB
	clock clock.Clock
}

// NewActions samples expiry time after acquiring the workflow's database locks.
func NewActions(db *gorm.DB, c clock.Clock) *ActionStore { return &ActionStore{db: db, clock: c} }

type invitationRow struct {
	ID, WorkspaceID, Email, Role, TokenHash, Status, InvitedByUserID string
	AcceptedByUserID                                                 *string
	TTLSeconds                                                       int64 `gorm:"column:ttl_seconds"`
	ExpiresAtMS                                                      int64 `gorm:"column:expires_at_ms"`
	EmailSent                                                        bool
	EmailErrorSummary                                                *string
	AcceptedAtMS                                                     *int64 `gorm:"column:accepted_at_ms"`
	RevokedAtMS                                                      *int64 `gorm:"column:revoked_at_ms"`
	CreatedAtMS                                                      int64  `gorm:"column:created_at_ms"`
	UpdatedAtMS                                                      int64  `gorm:"column:updated_at_ms"`
}

func (invitationRow) TableName() string { return "workspace_invitations" }
func (r invitationRow) domain(name string, now int64) workspace.Invitation {
	status := r.Status
	if status == "pending" && r.ExpiresAtMS <= now {
		status = "expired"
	}
	return workspace.Invitation{
		ID: r.ID, WorkspaceID: r.WorkspaceID, WorkspaceName: name, Email: r.Email, Role: r.Role, Status: status,
		InvitedByUserID: r.InvitedByUserID, AcceptedByUserID: r.AcceptedByUserID, TTLSeconds: r.TTLSeconds,
		ExpiresAtMS: r.ExpiresAtMS, AcceptedAtMS: r.AcceptedAtMS, RevokedAtMS: r.RevokedAtMS,
		CreatedAtMS: r.CreatedAtMS, UpdatedAtMS: r.UpdatedAtMS,
		Delivery: workspace.Delivery{EmailSent: r.EmailSent, EmailErrorSummary: r.EmailErrorSummary},
	}
}

type transferRow struct {
	ID, WorkspaceID, FromUserID, TargetUserID, TokenHash, Status string
	ExpiresAtMS                                                  int64 `gorm:"column:expires_at_ms"`
	EmailSent                                                    bool
	EmailErrorSummary                                            *string
	ConfirmedAtMS                                                *int64 `gorm:"column:confirmed_at_ms"`
	CancelledAtMS                                                *int64 `gorm:"column:cancelled_at_ms"`
	CreatedAtMS                                                  int64  `gorm:"column:created_at_ms"`
	UpdatedAtMS                                                  int64  `gorm:"column:updated_at_ms"`
}

func (transferRow) TableName() string { return "ownership_transfers" }
func (r transferRow) domain(now int64) workspace.OwnershipTransfer {
	status := r.Status
	if status == "pending" && r.ExpiresAtMS <= now {
		status = "expired"
	}
	return workspace.OwnershipTransfer{
		ID: r.ID, WorkspaceID: r.WorkspaceID, FromUserID: r.FromUserID, TargetUserID: r.TargetUserID, Status: status,
		ExpiresAtMS: r.ExpiresAtMS, ConfirmedAtMS: r.ConfirmedAtMS, CancelledAtMS: r.CancelledAtMS,
		CreatedAtMS: r.CreatedAtMS, UpdatedAtMS: r.UpdatedAtMS,
		Delivery: workspace.Delivery{EmailSent: r.EmailSent, EmailErrorSummary: r.EmailErrorSummary},
	}
}

func lockedActionWorkspace(tx *gorm.DB, wid string) (WorkspaceRow, error) {
	var row WorkspaceRow
	err := tx.Clauses(clause.Locking{Strength: "NO KEY UPDATE"}).Where("id = ?", wid).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return row, fault.Missing()
	}
	return row, err
}

func actionWorkspace(tx *gorm.DB, wid string) (WorkspaceRow, error) {
	row, err := lockedActionWorkspace(tx, wid)
	if err != nil {
		return row, err
	}
	if !row.IsActive {
		return row, fault.Missing()
	}
	return row, nil
}

func actionActor(tx *gorm.DB, scope workspace.ActionScope, permission workspace.Permission) (WorkspaceRow, MemberRow, error) {
	w, err := actionWorkspace(tx, scope.WorkspaceID)
	if err != nil {
		return w, MemberRow{}, err
	}
	var actor MemberRow
	err = tx.Clauses(clause.Locking{Strength: "SHARE"}).Where("workspace_id = ? AND user_id = ?", scope.WorkspaceID, scope.ActorID).Take(&actor).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return w, actor, fault.Missing()
	}
	if err != nil {
		return w, actor, err
	}
	var active int64
	if err := tx.Table("users").Where("id=? AND is_active", scope.ActorID).Count(&active).Error; err != nil {
		return w, actor, err
	}
	if active != 1 {
		return w, actor, fault.Missing()
	}
	if !workspace.Allowed(actor.Role, permission) {
		return w, actor, fault.Denied()
	}
	return w, actor, nil
}

func inviteState(row invitationRow, now int64) error {
	if row.Status == "expired" || (row.Status == "pending" && row.ExpiresAtMS <= now) {
		return fault.New(fault.Conflict, "INVITATION_EXPIRED", "邀请已过期，请重新邀请")
	}
	if row.Status != "pending" {
		return fault.New(fault.Conflict, "INVITATION_INVALID", "邀请无效或已使用")
	}
	return nil
}

func transferState(row transferRow, now int64) error {
	if row.Status == "expired" || (row.Status == "pending" && row.ExpiresAtMS <= now) {
		return fault.New(fault.Conflict, "OWNERSHIP_TRANSFER_EXPIRED", "所有权转移链接已过期")
	}
	if row.Status != "pending" {
		return transferInvalid()
	}
	return nil
}

func transferInvalid() error {
	return fault.New(fault.Conflict, "OWNERSHIP_TRANSFER_INVALID", "所有权转移链接无效或目标已变化")
}

// RecordDelivery prevents a delayed old send from overwriting a newer token's delivery state.
func (r *ActionStore) RecordDelivery(ctx context.Context, result workspace.DeliveryResult) error {
	var model any
	switch result.Kind {
	case workspace.InvitationMail:
		model = &invitationRow{}
	case workspace.OwnershipMail:
		model = &transferRow{}
	default:
		return errors.New("unknown action mail kind")
	}
	var summary *string
	if !result.Sent {
		value := workspace.DeliveryFailureSummary
		summary = &value
	}
	return r.db.WithContext(ctx).Model(model).Where("id = ? AND token_hash = ? AND status = 'pending'", result.ID, result.TokenHash).
		Updates(map[string]any{"email_sent": result.Sent, "email_error_summary": summary, "updated_at_ms": result.Timestamp}).Error
}
