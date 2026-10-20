package httpapi

import (
	"mime"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/platform/fault"
)

func (h *handler) importMarkdown(c *gin.Context) {
	var body struct {
		OperationID string  `json:"operation_id"`
		Title       string  `json:"title"`
		ParentID    *string `json:"parent_id"`
		Markdown    *string `json:"markdown"`
	}
	if err := decode(c, &body); err != nil {
		h.fail(c, err)
		return
	}
	if body.Markdown == nil {
		h.fail(c, fault.Field("body.markdown", "需要提供 Markdown 文本，可为空字符串"))
		return
	}
	input := integration.ImportInput{OperationID: body.OperationID, Title: body.Title, ParentID: body.ParentID, Markdown: *body.Markdown}
	result, err := h.deps.Transfers.Import(c.Request.Context(), directoryScope(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, gin.H{"document": h.documentResponse(result.Document), "warnings": result.Warnings})
}
func (h *handler) exportDocument(c *gin.Context) {
	secureContentHeaders(c)
	version, err := integerQuery(c, "version", 0)
	if err != nil {
		h.fail(c, err)
		return
	}

	result, err := h.deps.Transfers.Export(c.Request.Context(), integration.ExportQuery{Scope: directoryScope(c), Version: version})
	if err != nil {
		h.fail(c, err)
		return
	}
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": result.Title + ".md"}))
	c.Header("Content-Length", strconv.Itoa(len(result.Content)))
	c.Header("X-Document-Version", strconv.FormatInt(result.Version, 10))
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", result.Content)
}
