package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/table"
)

type tableDTO struct {
	TableID        string           `json:"table_id"`
	BlockID        string           `json:"block_id"`
	TableVersion   int64            `json:"table_version"`
	ContentVersion int64            `json:"content_version"`
	Definition     table.Definition `json:"definition"`
	CreatedAtMS    int64            `json:"created_at_ms"`
	UpdatedAtMS    int64            `json:"updated_at_ms"`
}

func tableResponse(meta table.Metadata) tableDTO {
	return tableDTO{
		TableID:        meta.TableID,
		BlockID:        meta.BlockID,
		TableVersion:   meta.TableVersion,
		ContentVersion: meta.ContentVersion,
		Definition:     meta.Definition,
		CreatedAtMS:    meta.CreatedAtMS,
		UpdatedAtMS:    meta.UpdatedAtMS,
	}
}
func tableScope(c *gin.Context) table.Scope {
	return table.Scope{ActorID: actor(c).UserID, WorkspaceID: c.Param("workspace_id"), DocumentID: c.Param("document_id"), TableID: c.Param("table_id")}
}
func tableQuery(c *gin.Context) (table.Query, error) {
	query := table.Query{Scope: tableScope(c)}
	version, err := integerQuery(c, "document_version", 0)
	if err != nil {
		return query, err
	}
	if _, present := c.Request.URL.Query()["document_version"]; present && version < 1 {
		return query, fault.Field("query.document_version", "文档版本号必须为正整数")
	}
	query.DocumentVersion = version
	values, present := c.Request.URL.Query()["view_id"]
	if present {
		if len(values) != 1 || !table.ValidID(values[0]) {
			return query, fault.Field("query.view_id", "视图 ID 必须是标准 UUID")
		}
		query.ViewID = values[0]
	}
	values, present = c.Request.URL.Query()["group_id"]
	if present {
		if len(values) != 1 {
			return query, fault.Field("query.group_id", "分组值只能出现一次")
		}
		query.GroupSet = true
		if values[0] != "none" {
			if !table.ValidID(values[0]) {
				return query, fault.Field("query.group_id", "分组值须为标准 UUID 或 none")
			}
			query.GroupID = &values[0]
		}
	}
	return query, nil
}
func (h *handler) createTable(c *gin.Context) {
	var input table.CreateInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Tables.Create(c.Request.Context(), tableScope(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, result)
}
func (h *handler) changeTable(c *gin.Context) {
	var input table.MutationInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Tables.Mutate(c.Request.Context(), tableScope(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) tableMetadata(c *gin.Context) {
	query, err := tableQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Tables.Metadata(c.Request.Context(), query)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, tableResponse(result))
}
func (h *handler) tableRecords(c *gin.Context) {
	query, err := tableQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	query.Page, err = pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Tables.Records(c.Request.Context(), query)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{
		"table":      tableResponse(result.Metadata),
		"view_id":    result.ViewID,
		"items":      result.Items,
		"groups":     result.Groups,
		"pagination": pageInfo{Page: query.Page.Number, PageSize: query.Page.Size, Total: result.Total},
	})
}
func (h *handler) exportTable(c *gin.Context) {
	secureContentHeaders(c)
	query, err := tableQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	format := "csv"
	if values, exists := c.Request.URL.Query()["format"]; exists {
		if len(values) != 1 {
			h.fail(c, fault.Field("query.format", "导出格式只能出现一次"))
			return
		}
		format = values[0]
	}
	content, err := h.deps.Tables.Export(c.Request.Context(), query, format)
	if err != nil {
		h.fail(c, err)
		return
	}
	media, filename := "text/csv; charset=utf-8", "table.csv"
	if format == "markdown" {
		media, filename = "text/markdown; charset=utf-8", "table.md"
	}
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.Header("Content-Length", strconv.Itoa(len(content)))
	c.Data(http.StatusOK, media, content)
}
