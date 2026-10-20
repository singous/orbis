package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/platform/fault"
)

func (h *handler) setWorkspacePreference(c *gin.Context) {
	var input struct {
		WorkspaceID optional[string] `json:"workspace_id"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if !input.WorkspaceID.Present {
		h.fail(c, fault.Field("body.workspace_id", "需要提供工作空间 ID 或 null"))
		return
	}
	result, err := h.deps.Preferences.SetWorkspacePreference(c.Request.Context(), actor(c), input.WorkspaceID.Value)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, userResponse(result))
}
func (h *handler) mailStatus(c *gin.Context) {
	enabled, err := h.deps.Actions.MailAvailable(c.Request.Context(), actor(c).UserID, c.Param("workspace_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"enabled": enabled})
}
