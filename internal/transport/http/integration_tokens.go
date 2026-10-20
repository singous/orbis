package httpapi

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/platform/fault"
)

func integrationScope(c *gin.Context) integration.TokenScope {
	return integration.TokenScope{ActorID: actor(c).UserID, WorkspaceID: c.Param("workspace_id"), TokenID: c.Param("token_id")}
}
func (h *handler) createIntegrationToken(c *gin.Context) {
	privatePublicHeaders(c)
	var input struct {
		Name          string                             `json:"name"`
		Permissions   optional[[]integration.Permission] `json:"permissions"`
		CollectionID  *string                            `json:"collection_id"`
		DocumentID    *string                            `json:"document_id"`
		ExpiresInDays optional[int]                      `json:"expires_in_days"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if err := nonNull("permissions", input.Permissions); err != nil {
		h.fail(c, err)
		return
	}
	if err := nonNull("expires_in_days", input.ExpiresInDays); err != nil {
		h.fail(c, err)
		return
	}
	value := integration.TokenInput{Name: input.Name, CollectionID: input.CollectionID, DocumentID: input.DocumentID}
	if input.Permissions.Value != nil {
		value.Permissions = *input.Permissions.Value
	}
	if input.ExpiresInDays.Value != nil {
		value.ExpiresInDays = *input.ExpiresInDays.Value
		if value.ExpiresInDays < 1 {
			h.fail(c, fault.Field("body.expires_in_days", "有效期须为 1 至 365 天"))
			return
		}
	}
	token, secret, err := h.deps.IntegrationTokens.Create(c.Request.Context(), integrationScope(c), value)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, gin.H{"credential": token, "token": secret})
}
func (h *handler) integrationTokens(c *gin.Context) {
	privatePublicHeaders(c)
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.IntegrationTokens.List(c.Request.Context(), integrationScope(c), page)
	if err != nil {
		h.fail(c, err)
		return
	}
	listResponse(c, items, total, page)
}
func (h *handler) revokeIntegrationToken(c *gin.Context) {
	privatePublicHeaders(c)
	var input struct {
		ExpectedVersion int64 `json:"expected_version"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.IntegrationTokens.Revoke(c.Request.Context(), integrationScope(c), input.ExpectedVersion)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}

const agentPrincipalKey = "orbis.integration_principal"

func integrationPrincipal(c *gin.Context) integration.Principal {
	return c.MustGet(agentPrincipalKey).(integration.Principal)
}
func (h *handler) authenticateIntegration() gin.HandlerFunc {
	return func(c *gin.Context) {
		fields := strings.Fields(c.GetHeader("Authorization"))
		if len(fields) != 2 || !strings.EqualFold(fields[0], "Bearer") {
			h.fail(c, integration.AuthRequired())
			return
		}
		principal, err := h.deps.IntegrationTokens.Authenticate(c.Request.Context(), fields[1], c.Param("workspace_id"))
		if err != nil {
			h.fail(c, err)
			return
		}
		c.Set(agentPrincipalKey, principal)
		c.Next()
	}
}
