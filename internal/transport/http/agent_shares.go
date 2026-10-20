package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/sharing"
)

func (h *handler) agentCreateShare(c *gin.Context) {
	privatePublicHeaders(c)
	var input sharing.CreateInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.CreateShare(c.Request.Context(), integrationPrincipal(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, gin.H{"share": shareResponse(result.Share, &result.Path), "path": result.Path, "behavior": "live", "includes_future_descendants": true})
}
func (h *handler) agentShares(c *gin.Context) {
	privatePublicHeaders(c)
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	q := sharing.ListQuery{Page: page}
	if _, exists := c.Request.URL.Query()["collection_id"]; exists {
		value, err := singleQuery(c, "collection_id", "")
		if err != nil {
			h.fail(c, err)
			return
		}
		q.CollectionID = &value
	}
	items, total, err := h.deps.Library.Shares(c.Request.Context(), integrationPrincipal(c), q)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]shareDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, shareResponse(item.Share, item.Path))
	}
	listResponse(c, rows, total, page)
}
func (h *handler) agentRevokeShare(c *gin.Context) {
	privatePublicHeaders(c)
	var input struct {
		ExpectedVersion int64 `json:"expected_version"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.RevokeShare(c.Request.Context(), integrationPrincipal(c), c.Param("share_id"), input.ExpectedVersion)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, shareResponse(result, nil))
}
