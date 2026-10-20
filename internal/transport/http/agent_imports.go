package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/platform/fault"
)

func (h *handler) agentBeginImport(c *gin.Context) {
	var request struct {
		integration.StagedImportInput
		Size *int64 `json:"size_bytes"`
	}
	if err := decode(c, &request); err != nil {
		h.fail(c, err)
		return
	}
	if request.Size == nil {
		h.fail(c, fault.Field("body.size_bytes", "需要声明源文件大小"))
		return
	}
	input := request.StagedImportInput
	input.SizeBytes = *request.Size
	result, err := h.deps.Imports.Begin(c.Request.Context(), integrationPrincipal(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, result)
}
func (h *handler) agentImportStatus(c *gin.Context) {
	result, err := h.deps.Imports.Status(c.Request.Context(), integrationPrincipal(c), c.Param("import_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) agentImportChunk(c *gin.Context) {
	raw, err := singleQuery(c, "offset", "0")
	if err != nil {
		h.fail(c, err)
		return
	}
	offset, err := strconv.ParseInt(raw, 10, 64)
	if err == nil && (offset < 0 || offset > integration.MaxStagedImportBytes) {
		err = fault.Field("query.offset", "偏移须在源文件大小范围内")
	}
	if err != nil {
		h.fail(c, fault.Field("query.offset", "偏移须为非负整数"))
		return
	}
	if err != nil {
		h.fail(c, err)
		return
	}
	if c.ContentType() != "application/octet-stream" {
		h.fail(c, fault.Field("header.content-type", "分块须使用 application/octet-stream"))
		return
	}
	result, err := h.deps.Imports.Chunk(c.Request.Context(), integrationPrincipal(c), c.Param("import_id"), offset, c.GetHeader("X-Chunk-SHA256"), c.Request.Body)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) agentFinalizeImport(c *gin.Context) {
	result, err := h.deps.Imports.Finalize(c.Request.Context(), integrationPrincipal(c), c.Param("import_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	status := http.StatusAccepted
	if result.State == "completed" || result.State == "failed" {
		status = http.StatusOK
	}
	success(c, status, result)
}
