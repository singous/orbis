package httpapi

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"orbis.local/orbis/internal/identity"
)

func (h *handler) updateProfile(c *gin.Context) {
	var input struct {
		ExpectedVersion int64            `json:"expected_version"`
		DisplayName     optional[string] `json:"display_name"`
		Bio             optional[string] `json:"bio"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	user, err := h.deps.Identity.UpdateProfile(c.Request.Context(), actor(c), identity.ProfileChange{
		ExpectedVersion: input.ExpectedVersion, NameSet: input.DisplayName.Present, DisplayName: input.DisplayName.Value, BioSet: input.Bio.Present, Bio: input.Bio.Value,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, userResponse(user))
}
