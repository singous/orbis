package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/workspace"
)

type invitationDTO struct {
	ID                string  `json:"id"`
	WorkspaceID       string  `json:"workspace_id"`
	WorkspaceName     string  `json:"workspace_name"`
	Email             string  `json:"email"`
	Role              string  `json:"role"`
	Status            string  `json:"status"`
	InvitedByUserID   string  `json:"invited_by_user_id"`
	AcceptedByUserID  *string `json:"accepted_by_user_id"`
	TTLSeconds        int64   `json:"ttl_seconds"`
	ExpiresAtMS       int64   `json:"expires_at_ms"`
	EmailSent         bool    `json:"email_sent"`
	EmailErrorSummary *string `json:"email_error_summary"`
	AcceptedAtMS      *int64  `json:"accepted_at_ms"`
	RevokedAtMS       *int64  `json:"revoked_at_ms"`
	CreatedAtMS       int64   `json:"created_at_ms"`
	UpdatedAtMS       int64   `json:"updated_at_ms"`
}

func invitationResponse(i workspace.Invitation) invitationDTO {
	return invitationDTO{ID: i.ID, WorkspaceID: i.WorkspaceID, WorkspaceName: i.WorkspaceName, Email: i.Email, Role: i.Role, Status: i.Status,
		InvitedByUserID: i.InvitedByUserID, AcceptedByUserID: i.AcceptedByUserID, TTLSeconds: i.TTLSeconds, ExpiresAtMS: i.ExpiresAtMS,
		EmailSent: i.EmailSent, EmailErrorSummary: i.EmailErrorSummary, AcceptedAtMS: i.AcceptedAtMS, RevokedAtMS: i.RevokedAtMS,
		CreatedAtMS: i.CreatedAtMS, UpdatedAtMS: i.UpdatedAtMS}
}

type transferDTO struct {
	ID                string  `json:"id"`
	WorkspaceID       string  `json:"workspace_id"`
	FromUserID        string  `json:"from_user_id"`
	TargetUserID      string  `json:"target_user_id"`
	Status            string  `json:"status"`
	ExpiresAtMS       int64   `json:"expires_at_ms"`
	EmailSent         bool    `json:"email_sent"`
	EmailErrorSummary *string `json:"email_error_summary"`
	ConfirmedAtMS     *int64  `json:"confirmed_at_ms"`
	CancelledAtMS     *int64  `json:"cancelled_at_ms"`
	CreatedAtMS       int64   `json:"created_at_ms"`
	UpdatedAtMS       int64   `json:"updated_at_ms"`
}

func transferResponse(t workspace.OwnershipTransfer) transferDTO {
	return transferDTO{ID: t.ID, WorkspaceID: t.WorkspaceID, FromUserID: t.FromUserID, TargetUserID: t.TargetUserID, Status: t.Status,
		ExpiresAtMS: t.ExpiresAtMS, EmailSent: t.EmailSent, EmailErrorSummary: t.EmailErrorSummary,
		ConfirmedAtMS: t.ConfirmedAtMS, CancelledAtMS: t.CancelledAtMS, CreatedAtMS: t.CreatedAtMS, UpdatedAtMS: t.UpdatedAtMS}
}

func actionScope(c *gin.Context) workspace.ActionScope {
	id := c.Param("invitation_id")
	if id == "" {
		id = c.Param("transfer_id")
	}
	return workspace.ActionScope{WorkspaceID: c.Param("workspace_id"), ActorID: actor(c).UserID, ActionID: id}
}

func (h *handler) invitations(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Actions.Invitations(c.Request.Context(), actionScope(c), page)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]invitationDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, invitationResponse(item))
	}
	listResponse(c, rows, total, page)
}

func (h *handler) invite(c *gin.Context) {
	var input struct {
		Email      string          `json:"email"`
		Role       string          `json:"role"`
		TTLSeconds optional[int64] `json:"ttl_seconds"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	ttl := int64(workspace.InvitationTTL / time.Second)
	if input.TTLSeconds.Present {
		if input.TTLSeconds.Value == nil {
			h.fail(c, fault.Field("body.ttl_seconds", "有效期不能为 null"))
			return
		}
		ttl = *input.TTLSeconds.Value
	}
	item, err := h.deps.Actions.Invite(c.Request.Context(), workspace.InvitationCreate{Scope: actionScope(c), Email: input.Email, Role: input.Role, TTLSeconds: ttl})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, invitationResponse(item))
}

func (h *handler) resendInvitation(c *gin.Context) {
	item, err := h.deps.Actions.ResendInvitation(c.Request.Context(), actionScope(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, invitationResponse(item))
}

func (h *handler) revokeInvitation(c *gin.Context) {
	item, err := h.deps.Actions.RevokeInvitation(c.Request.Context(), actionScope(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, invitationResponse(item))
}

func (h *handler) inspectInvitation(c *gin.Context) {
	var input struct {
		Token string `json:"token"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	item, err := h.deps.Actions.InspectInvitation(c.Request.Context(), input.Token)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"workspace_name": item.WorkspaceName, "email": item.Email, "role": item.Role,
		"expires_at_ms": item.ExpiresAtMS, "account_exists": item.ExistingUserID != nil})
}

func (h *handler) acceptInvitation(c *gin.Context) {
	var input struct {
		Token       string  `json:"token"`
		Password    *string `json:"password"`
		DisplayName *string `json:"display_name"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	actorID := ""
	if header := c.GetHeader("Authorization"); header != "" {
		parts := strings.Fields(header)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			h.fail(c, fault.Auth())
			return
		}
		user, err := h.deps.Identity.Authenticate(c.Request.Context(), parts[1])
		if err != nil {
			h.fail(c, err)
			return
		}
		actorID = user.UserID
	}
	result, err := h.deps.Actions.AcceptInvitation(c.Request.Context(), workspace.AcceptInput{
		Token: input.Token, ActorID: actorID, Password: input.Password, DisplayName: input.DisplayName,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	var session *tokensDTO
	if result.Tokens != nil {
		value := tokensResponse(*result.Tokens)
		session = &value
	}
	success(c, http.StatusOK, gin.H{"user": userResponse(result.User), "member": memberResponse(result.Member), "session": session})
}

func (h *handler) currentOwnership(c *gin.Context) {
	item, err := h.deps.Actions.CurrentTransfer(c.Request.Context(), actionScope(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, transferResponse(item))
}

func (h *handler) transferOwnership(c *gin.Context) {
	var input struct {
		TargetUserID string `json:"target_user_id"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	item, err := h.deps.Actions.Transfer(c.Request.Context(), actionScope(c), input.TargetUserID)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, transferResponse(item))
}

func (h *handler) resendOwnership(c *gin.Context) {
	item, err := h.deps.Actions.ResendTransfer(c.Request.Context(), actionScope(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, transferResponse(item))
}

func (h *handler) cancelOwnership(c *gin.Context) {
	item, err := h.deps.Actions.CancelTransfer(c.Request.Context(), actionScope(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, transferResponse(item))
}

func (h *handler) confirmOwnership(c *gin.Context) {
	var input struct {
		Token string `json:"token"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	item, err := h.deps.Actions.ConfirmTransfer(c.Request.Context(), input.Token)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, transferResponse(item))
}
