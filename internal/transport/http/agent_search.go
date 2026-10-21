package httpapi

import (
	"github.com/gin-gonic/gin"

	"orbis.local/orbis/internal/integration"
)

func (h *handler) agentSearch(c *gin.Context) {
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	q.Text, err = singleQuery(c, "q", "")
	if err != nil {
		h.fail(c, err)
		return
	}
	if _, ok := c.Request.URL.Query()["collection_id"]; ok {
		value, err := singleQuery(c, "collection_id", "")
		if err != nil {
			h.fail(c, err)
			return
		}
		q.CollectionID = &value
	}
	hits, total, err := h.deps.Library.Search(c.Request.Context(), q)
	if err != nil {
		h.fail(c, err)
		return
	}
	type item struct {
		Document documentDTO                `json:"document"`
		Anchors  []integration.SearchAnchor `json:"anchors"`
	}
	items := make([]item, 0, len(hits))
	for _, hit := range hits {
		items = append(items, item{h.documentResponse(hit.Document), hit.Anchors})
	}
	listResponse(c, items, total, q.Page)
}
