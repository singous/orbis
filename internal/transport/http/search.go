package httpapi

import (
	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/search"
)

func singleQuery(c *gin.Context, key, defaultValue string) (string, error) {
	values, exists := c.Request.URL.Query()[key]
	if !exists {
		return defaultValue, nil
	}
	if len(values) != 1 {
		return "", fault.Field("query."+key, "查询参数只能出现一次")
	}
	return values[0], nil
}
func (h *handler) search(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	query := search.Query{ActorID: actor(c).UserID, WorkspaceID: c.Param("workspace_id"), Page: page}
	for key, target := range map[string]*string{"q": &query.Text, "type": &query.Type, "status": &query.Status} {
		defaults := map[string]string{"q": "", "type": "all", "status": "active"}
		value, err := singleQuery(c, key, defaults[key])
		if err != nil {
			h.fail(c, err)
			return
		}
		*target = value
	}
	if _, exists := c.Request.URL.Query()["resource_id"]; exists {
		value, err := singleQuery(c, "resource_id", "")
		if err != nil {
			h.fail(c, err)
			return
		}
		query.ResourceID = &value
	}
	result, err := h.deps.Search.Search(c.Request.Context(), query)
	if err != nil {
		h.fail(c, err)
		return
	}
	items := make([]gin.H, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, gin.H{
			"id":                 item.ID,
			"type":               item.Type,
			"workspace_id":       item.WorkspaceID,
			"title":              item.Title,
			"location":           item.Location,
			"snippet":            item.Snippet,
			"match":              item.Match,
			"matched_comment_id": item.MatchedCommentID,
			"status":             item.Status,
			"updated_at_ms":      item.UpdatedAtMS,
			"collection_id":      item.CollectionID,
			"group_id":           item.GroupID,
		})
	}
	listResponse(c, items, result.Total, page)
}
