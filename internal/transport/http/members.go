package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"orbis.local/orbis/internal/workspace"
)

type memberDTO struct {
	WorkspaceID string `json:"workspace_id"`
	UserID      string `json:"user_id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
	Version     int64  `json:"version"`
	CreatedAtMS int64  `json:"created_at_ms"`
	UpdatedAtMS int64  `json:"updated_at_ms"`
}

func memberResponse(m workspace.Member) memberDTO {
	return memberDTO{
		WorkspaceID: m.WorkspaceID, UserID: m.UserID, Email: m.Email, DisplayName: m.DisplayName,
		Role: m.Role, Version: m.Version, CreatedAtMS: m.CreatedAtMS, UpdatedAtMS: m.UpdatedAtMS,
	}
}

func memberScope(c *gin.Context) workspace.MemberScope {
	return workspace.MemberScope{WorkspaceID: c.Param("workspace_id"), ActorID: actor(c).UserID}
}

func (h *handler) members(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Workspaces.Members(c.Request.Context(), memberScope(c), page)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]memberDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, memberResponse(item))
	}
	listResponse(
		c,
		rows,
		total,
		page,
	)
}

func (h *handler) changeMember(c *gin.Context) {
	var input struct {
		Role            string `json:"role"`
		ExpectedVersion int64  `json:"expected_version"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	item, err := h.deps.Workspaces.ChangeMember(c.Request.Context(), workspace.MemberChange{
		Scope: memberScope(c), UserID: c.Param("user_id"), Role: input.Role, ExpectedVersion: input.ExpectedVersion,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, memberResponse(item))
}

func (h *handler) removeMember(c *gin.Context) {
	var input struct {
		ExpectedVersion int64 `json:"expected_version"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if err := h.deps.Workspaces.RemoveMember(c.Request.Context(), workspace.MemberChange{
		Scope: memberScope(c), UserID: c.Param("user_id"), ExpectedVersion: input.ExpectedVersion,
	}); err != nil {
		h.fail(c, err)
		return
	}
	success[any](c, http.StatusOK, nil)
}
