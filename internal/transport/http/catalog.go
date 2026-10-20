package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

type groupDTO struct {
	IsArchived   bool   `json:"is_archived"`
	ID           string `json:"id"`
	WorkspaceID  string `json:"workspace_id"`
	Name         string `json:"name"`
	IsDefault    bool   `json:"is_default"`
	SortOrder    int    `json:"sort_order"`
	Version      int64  `json:"version"`
	ArchivedAtMS *int64 `json:"archived_at_ms"`
	CreatedAtMS  int64  `json:"created_at_ms"`
	UpdatedAtMS  int64  `json:"updated_at_ms"`
}

func groupResponse(g document.Group) groupDTO {
	return groupDTO{
		ID:           g.ID,
		WorkspaceID:  g.WorkspaceID,
		Name:         g.Name,
		IsDefault:    g.IsDefault,
		SortOrder:    g.SortOrder,
		Version:      g.Version,
		ArchivedAtMS: g.ArchivedAtMS, IsArchived: g.IsArchived,
		CreatedAtMS: g.CreatedAtMS,
		UpdatedAtMS: g.UpdatedAtMS,
	}
}
func nonNull[T any](field string, value optional[T]) error {
	if value.Present && value.Value == nil {
		return fault.Field("body."+field, field+" 不能为 null")
	}
	return nil
}
func groupQuery(c *gin.Context) (*string, error) {
	values, exists := c.Request.URL.Query()["group_id"]
	if !exists {
		return nil, nil
	}
	if len(values) != 1 {
		return nil, fault.Field("query.group_id", "分组 ID 只能出现一次")
	}
	id, err := uuid.Parse(values[0])
	if err != nil || id == uuid.Nil || id.String() != values[0] {
		return nil, fault.Field("query.group_id", "分组 ID 必须是标准 UUID")
	}
	return &values[0], nil
}
func (h *handler) groups(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	archived, err := archivedQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Catalog.Groups(c.Request.Context(), directoryScope(c), page, archived)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]groupDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, groupResponse(item))
	}
	listResponse(c, rows, total, page)
}
func (h *handler) group(c *gin.Context) {
	item, err := h.deps.Catalog.Group(c.Request.Context(), directoryScope(c), c.Param("group_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, groupResponse(item))
}
func (h *handler) createGroup(c *gin.Context) {
	var input struct {
		Name      *string       `json:"name"`
		SortOrder optional[int] `json:"sort_order"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if err := nonNull("sort_order", input.SortOrder); err != nil {
		h.fail(c, err)
		return
	}
	item, err := h.deps.Catalog.CreateGroup(c.Request.Context(), document.GroupChange{Scope: directoryScope(c), Name: input.Name, SortOrder: input.SortOrder.Value})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, groupResponse(item))
}
func (h *handler) updateGroup(c *gin.Context) {
	var input struct {
		ExpectedVersion int64            `json:"expected_version"`
		Name            optional[string] `json:"name"`
		SortOrder       optional[int]    `json:"sort_order"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if err := nonNull("name", input.Name); err != nil {
		h.fail(c, err)
		return
	}
	if err := nonNull("sort_order", input.SortOrder); err != nil {
		h.fail(c, err)
		return
	}
	item, err := h.deps.Catalog.UpdateGroup(c.Request.Context(), document.GroupChange{
		Scope:           directoryScope(c),
		GroupID:         c.Param("group_id"),
		ExpectedVersion: input.ExpectedVersion,
		Name:            input.Name.Value,
		SortOrder:       input.SortOrder.Value,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, groupResponse(item))
}
func (h *handler) archiveGroup(c *gin.Context) {
	var input struct {
		ExpectedVersion int64 `json:"expected_version"`
		Archived        *bool `json:"archived"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if input.Archived == nil {
		h.fail(c, fault.Field("body.archived", "archived 必须是布尔值"))
		return
	}
	item, err := h.deps.Catalog.UpdateGroup(
		c.Request.Context(),
		document.GroupChange{Scope: directoryScope(c), GroupID: c.Param("group_id"), ExpectedVersion: input.ExpectedVersion, Archived: input.Archived},
	)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, groupResponse(item))
}
func (h *handler) updateCollection(c *gin.Context) {
	var input struct {
		Icon            optional[document.CollectionIcon] `json:"icon"`
		ExpectedVersion int64                             `json:"expected_version"`
		Title           optional[string]                  `json:"title"`
		SortOrder       optional[int]                     `json:"sort_order"`
		GroupID         optional[string]                  `json:"group_id"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if err := nonNull("title", input.Title); err != nil {
		h.fail(c, err)
		return
	}
	if err := nonNull("sort_order", input.SortOrder); err != nil {
		h.fail(c, err)
		return
	}
	item, err := h.deps.Catalog.UpdateCollection(c.Request.Context(), document.CollectionChange{IconSet: input.Icon.Present, Icon: input.Icon.Value,
		Scope:           directoryScope(c),
		ExpectedVersion: input.ExpectedVersion,
		Title:           input.Title.Value,
		SortOrder:       input.SortOrder.Value,
		GroupSet:        input.GroupID.Present,
		GroupID:         input.GroupID.Value,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, collectionResponse(item))
}
