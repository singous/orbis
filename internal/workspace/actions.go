package workspace

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/identity"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/platform/security"
)

const InvitationTTL = 24 * time.Hour
const MaxInvitationTTL = 7 * 24 * time.Hour
const OwnershipTTL = 15 * time.Minute
const InvitationMail = "workspace_invitation"
const OwnershipMail = "ownership_transfer_confirmation"
const DeliveryFailureSummary = "邮件投递失败，请检查配置后重发"

type Delivery struct {
	EmailSent         bool
	EmailErrorSummary *string
}

type Invitation struct {
	ID, WorkspaceID, WorkspaceName, Email, Role, Status, InvitedByUserID string
	AcceptedByUserID                                                     *string
	TTLSeconds                                                           int64
	ExpiresAtMS                                                          int64
	AcceptedAtMS, RevokedAtMS                                            *int64
	CreatedAtMS, UpdatedAtMS                                             int64
	ExistingUserID                                                       *string
	Delivery
}

type OwnershipTransfer struct {
	ID, WorkspaceID, WorkspaceName, FromUserID, TargetUserID, Status string
	Recipient, TargetDisplayName                                     string
	ExpiresAtMS                                                      int64
	ConfirmedAtMS, CancelledAtMS                                     *int64
	CreatedAtMS, UpdatedAtMS                                         int64
	Delivery
}

type ActionMail struct {
	Kind              string `json:"kind"`
	ActionID          string `json:"action_id"`
	Recipient         string `json:"recipient"`
	Token             string `json:"token"`
	URL               string `json:"url"`
	WorkspaceName     string `json:"workspace_name"`
	Role              string `json:"role"`
	TargetDisplayName string `json:"target_display_name"`
	ExpiresAtMS       int64  `json:"expires_at_ms"`
}

type ActionMailer interface {
	Available() bool
	Send(context.Context, ActionMail) error
}

type ActionScope struct{ WorkspaceID, ActorID, ActionID string }
type InvitationCreate struct {
	Scope       ActionScope
	Email, Role string
	TTLSeconds  int64
}
type InvitationWrite struct {
	Input         InvitationCreate
	ID, TokenHash string
}
type ActionRotation struct {
	Scope     ActionScope
	TokenHash string
}
type OwnershipCreate struct {
	Scope                       ActionScope
	TargetUserID, ID, TokenHash string
}
type DeliveryResult struct {
	Kind, ID, TokenHash string
	Sent                bool
	Timestamp           int64
}
type AcceptInput struct {
	Token, ActorID        string
	Password, DisplayName *string
}
type InvitationAcceptance struct {
	TokenHash, ActorID string
	Candidate          *identity.User
	Session            *identity.Session
}
type Acceptance struct {
	User       identity.User
	Member     Member
	NewAccount bool
	Tokens     *identity.Tokens
}

type ActionRepository interface {
	Invitations(context.Context, ActionScope, pagination.Page, int64) ([]Invitation, int64, error)
	CreateInvitation(context.Context, InvitationWrite) (Invitation, error)
	RotateInvitation(context.Context, ActionRotation) (Invitation, error)
	RevokeInvitation(context.Context, ActionScope) (Invitation, error)
	InspectInvitation(context.Context, string) (Invitation, error)
	AcceptInvitation(context.Context, InvitationAcceptance) (Acceptance, error)
	CurrentTransfer(context.Context, ActionScope) (OwnershipTransfer, error)
	CreateTransfer(context.Context, OwnershipCreate) (OwnershipTransfer, error)
	RotateTransfer(context.Context, ActionRotation) (OwnershipTransfer, error)
	CancelTransfer(context.Context, ActionScope) (OwnershipTransfer, error)
	ConfirmTransfer(context.Context, string) (OwnershipTransfer, error)
	RecordDelivery(context.Context, DeliveryResult) error
}

type Actions struct {
	legacyTokenSecret string
	repo              ActionRepository
	access            *Service
	accounts          *identity.Service
	mailer            ActionMailer
	clock             clock.Clock
	baseURL           string
	logger            *slog.Logger
}

type ActionOptions struct {
	LegacyTokenSecret string
	Accounts          *identity.Service
	Mailer            ActionMailer
	Clock             clock.Clock
	PublicBaseURL     string
	Logger            *slog.Logger
}

// NewActions wires the mail-confirmed membership workflows without exposing transport credentials.
func NewActions(repo ActionRepository, access *Service, options ActionOptions) *Actions {
	return &Actions{legacyTokenSecret: options.LegacyTokenSecret, repo: repo, access: access, accounts: options.Accounts, mailer: options.Mailer,
		clock: options.Clock, baseURL: options.PublicBaseURL, logger: options.Logger}
}

// ActionHash separates capability token purposes before storing their digest.
func ActionHash(kind, token string) string { return security.Digest(kind + ":" + token) }

func (s *Actions) inputHash(kind, token string) (string, bool) {
	if len(token) == 43 {
		return ActionHash(kind, token), true
	}
	if len(token) == 64 && s.legacyTokenSecret != "" {
		digest := hmac.New(sha256.New, []byte(s.legacyTokenSecret))
		_, _ = digest.Write([]byte(token))
		return hex.EncodeToString(digest.Sum(nil)), true
	}
	return "", false
}
func invitationInvalid() error {
	return fault.New(fault.Conflict, "INVITATION_INVALID", "邀请无效或已使用")
}

func (s *Actions) requireMail() error {
	if !s.mailer.Available() {
		return fault.New(fault.Unavailable, "MAIL_UNAVAILABLE", "邮件服务尚未配置")
	}
	return nil
}

func (s *Actions) link(kind, token string) string {
	base, _ := url.Parse(s.baseURL)
	path := "/invitations/accept"
	if kind == OwnershipMail {
		path = "/ownership-transfers/confirm"
	}
	base.Path = strings.TrimRight(base.Path, "/") + path
	base.Fragment = url.Values{"token": []string{token}}.Encode()
	return base.String()
}

func (s *Actions) deliver(ctx context.Context, message ActionMail) (Delivery, int64, error) {
	delivery := Delivery{EmailSent: true}
	if err := s.mailer.Send(ctx, message); err != nil {
		delivery.EmailSent = false
		summary := DeliveryFailureSummary
		delivery.EmailErrorSummary = &summary
		s.logger.WarnContext(ctx, "Action email delivery failed", "kind", message.Kind, "action_id", message.ActionID)
	}
	timestamp := s.clock.Now().UnixMilli()
	err := s.repo.RecordDelivery(ctx, DeliveryResult{
		Kind: message.Kind, ID: message.ActionID, TokenHash: ActionHash(message.Kind, message.Token),
		Sent: delivery.EmailSent, Timestamp: timestamp,
	})
	return delivery, timestamp, err
}

func (s *Actions) sendInvitation(ctx context.Context, invitation Invitation, token string) (Invitation, error) {
	delivery, timestamp, err := s.deliver(ctx, ActionMail{
		Kind: InvitationMail, ActionID: invitation.ID, Recipient: invitation.Email, Token: token,
		URL: s.link(InvitationMail, token), WorkspaceName: invitation.WorkspaceName, Role: invitation.Role, ExpiresAtMS: invitation.ExpiresAtMS,
	})
	invitation.Delivery = delivery
	invitation.UpdatedAtMS = timestamp
	return invitation, err
}

// Invitations lists lifecycle state; capability tokens never appear in the returned records.
func (s *Actions) Invitations(ctx context.Context, scope ActionScope, page pagination.Page) ([]Invitation, int64, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, ManageMembers); err != nil {
		return nil, 0, err
	}
	return s.repo.Invitations(ctx, scope, page, s.clock.Now().UnixMilli())
}

// Invite persists authorization before sending mail; a delivery failure leaves the pending record retryable.
func (s *Actions) Invite(ctx context.Context, input InvitationCreate) (Invitation, error) {
	if err := s.access.Require(ctx, input.Scope.ActorID, input.Scope.WorkspaceID, ManageMembers); err != nil {
		return Invitation{}, err
	}
	if err := s.requireMail(); err != nil {
		return Invitation{}, err
	}
	email, err := identity.NormalizeEmail(input.Email)
	if err != nil {
		return Invitation{}, err
	}
	input.Email = email
	if input.Role != "admin" && input.Role != "editor" && input.Role != "viewer" {
		return Invitation{}, fault.Field("body.role", "邀请角色不正确")
	}
	if input.TTLSeconds < 60 || input.TTLSeconds > int64(MaxInvitationTTL/time.Second) {
		return Invitation{}, fault.Field("body.ttl_seconds", "邀请有效期须在 60 秒至 7 天之间")
	}
	token, err := security.RandomToken()
	if err != nil {
		return Invitation{}, err
	}
	invitation, err := s.repo.CreateInvitation(ctx, InvitationWrite{Input: input, ID: uuid.NewString(), TokenHash: ActionHash(InvitationMail, token)})
	if err != nil {
		return Invitation{}, err
	}
	return s.sendInvitation(ctx, invitation, token)
}

// ResendInvitation invalidates the old capability before producing a replacement message.
func (s *Actions) ResendInvitation(ctx context.Context, scope ActionScope) (Invitation, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, ManageMembers); err != nil {
		return Invitation{}, err
	}
	if err := s.requireMail(); err != nil {
		return Invitation{}, err
	}
	token, err := security.RandomToken()
	if err != nil {
		return Invitation{}, err
	}
	invitation, err := s.repo.RotateInvitation(ctx, ActionRotation{Scope: scope, TokenHash: ActionHash(InvitationMail, token)})
	if err != nil {
		return Invitation{}, err
	}
	return s.sendInvitation(ctx, invitation, token)
}

// RevokeInvitation consumes a pending invitation without changing existing accounts.
func (s *Actions) RevokeInvitation(ctx context.Context, scope ActionScope) (Invitation, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, ManageMembers); err != nil {
		return Invitation{}, err
	}
	return s.repo.RevokeInvitation(ctx, scope)
}

// InspectInvitation reveals registration requirements only to a holder of a live capability.
func (s *Actions) InspectInvitation(ctx context.Context, token string) (Invitation, error) {
	hash, valid := s.inputHash(InvitationMail, token)
	if !valid {
		return Invitation{}, invitationInvalid()
	}
	return s.repo.InspectInvitation(ctx, hash)
}

// AcceptInvitation never resets an existing password; first registration joins and signs in atomically.
func (s *Actions) AcceptInvitation(ctx context.Context, input AcceptInput) (Acceptance, error) {
	invitation, err := s.InspectInvitation(ctx, input.Token)
	if err != nil {
		return Acceptance{}, err
	}
	hash, _ := s.inputHash(InvitationMail, input.Token)
	command := InvitationAcceptance{TokenHash: hash, ActorID: input.ActorID}
	var tokens identity.Tokens
	if invitation.ExistingUserID != nil {
		if input.ActorID == "" {
			return Acceptance{}, fault.New(fault.Unauthenticated, "INVITATION_LOGIN_REQUIRED", "请登录受邀邮箱对应的账号")
		}
		if input.ActorID != *invitation.ExistingUserID {
			return Acceptance{}, fault.New(fault.Forbidden, "INVITATION_ACCOUNT_MISMATCH", "请使用受邀邮箱对应的账号")
		}
	} else {
		if input.ActorID != "" {
			return Acceptance{}, fault.New(fault.Forbidden, "INVITATION_ACCOUNT_MISMATCH", "当前账号与邀请邮箱不一致")
		}
		if input.Password == nil || input.DisplayName == nil {
			return Acceptance{}, fault.Field("body", "首次加入需要密码和显示名称")
		}
		user, err := s.accounts.PrepareUser(ctx, invitation.Email, *input.Password, *input.DisplayName)
		if err != nil {
			return Acceptance{}, err
		}
		session, prepared, err := s.accounts.PrepareSession(user)
		if err != nil {
			return Acceptance{}, err
		}
		command.Candidate, command.Session = &user, &session
		tokens = prepared
	}
	accepted, err := s.repo.AcceptInvitation(ctx, command)
	if err != nil {
		return Acceptance{}, err
	}
	if accepted.NewAccount {
		accepted.Tokens = &tokens
	}
	return accepted, nil
}

func (s *Actions) sendTransfer(ctx context.Context, transfer OwnershipTransfer, token string) (OwnershipTransfer, error) {
	delivery, timestamp, err := s.deliver(ctx, ActionMail{
		Kind: OwnershipMail, ActionID: transfer.ID, Recipient: transfer.Recipient, Token: token, URL: s.link(OwnershipMail, token),
		WorkspaceName: transfer.WorkspaceName, TargetDisplayName: transfer.TargetDisplayName, ExpiresAtMS: transfer.ExpiresAtMS,
	})
	transfer.Delivery = delivery
	transfer.UpdatedAtMS = timestamp
	return transfer, err
}

// CurrentTransfer reports only the current owner's live pending request.
func (s *Actions) CurrentTransfer(ctx context.Context, scope ActionScope) (OwnershipTransfer, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, TransferOwnership); err != nil {
		return OwnershipTransfer{}, err
	}
	return s.repo.CurrentTransfer(ctx, scope)
}

// Transfer requires an existing administrator and sends confirmation to the current owner.
func (s *Actions) Transfer(ctx context.Context, scope ActionScope, target string) (OwnershipTransfer, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, TransferOwnership); err != nil {
		return OwnershipTransfer{}, err
	}
	if err := s.requireMail(); err != nil {
		return OwnershipTransfer{}, err
	}
	id, err := uuid.Parse(target)
	if err != nil || id == uuid.Nil || id.String() != target {
		return OwnershipTransfer{}, fault.Field("body.target_user_id", "目标用户 ID 不正确")
	}
	token, err := security.RandomToken()
	if err != nil {
		return OwnershipTransfer{}, err
	}
	transfer, err := s.repo.CreateTransfer(ctx, OwnershipCreate{
		Scope: scope, TargetUserID: target, ID: uuid.NewString(), TokenHash: ActionHash(OwnershipMail, token),
	})
	if err != nil {
		return OwnershipTransfer{}, err
	}
	return s.sendTransfer(ctx, transfer, token)
}

// ResendTransfer rotates the confirmation capability after rechecking the owner and target.
func (s *Actions) ResendTransfer(ctx context.Context, scope ActionScope) (OwnershipTransfer, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, TransferOwnership); err != nil {
		return OwnershipTransfer{}, err
	}
	if err := s.requireMail(); err != nil {
		return OwnershipTransfer{}, err
	}
	token, err := security.RandomToken()
	if err != nil {
		return OwnershipTransfer{}, err
	}
	transfer, err := s.repo.RotateTransfer(ctx, ActionRotation{Scope: scope, TokenHash: ActionHash(OwnershipMail, token)})
	if err != nil {
		return OwnershipTransfer{}, err
	}
	return s.sendTransfer(ctx, transfer, token)
}

// CancelTransfer invalidates a pending confirmation without changing membership roles.
func (s *Actions) CancelTransfer(ctx context.Context, scope ActionScope) (OwnershipTransfer, error) {
	if err := s.access.Require(ctx, scope.ActorID, scope.WorkspaceID, TransferOwnership); err != nil {
		return OwnershipTransfer{}, err
	}
	return s.repo.CancelTransfer(ctx, scope)
}

// ConfirmTransfer uses the emailed capability and rechecks both roles in the commit transaction.
func (s *Actions) ConfirmTransfer(ctx context.Context, token string) (OwnershipTransfer, error) {
	hash, valid := s.inputHash(OwnershipMail, token)
	if !valid {
		return OwnershipTransfer{}, fault.New(fault.Conflict, "OWNERSHIP_TRANSFER_INVALID", "所有权转移链接无效或已使用")
	}
	return s.repo.ConfirmTransfer(ctx, hash)
}

// MailAvailable describes configured delivery without connecting to the SMTP server.
func (s *Actions) MailAvailable(ctx context.Context, actor, wid string) (bool, error) {
	if err := s.access.Require(ctx, actor, wid, Read); err != nil {
		return false, err
	}
	return s.mailer.Available(), nil
}
