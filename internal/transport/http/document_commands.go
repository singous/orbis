package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/document"
)

func (h *handler) applyDocumentCommands(c *gin.Context) {
	var input document.CommandsInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Documents.ApplyCommands(c.Request.Context(), directoryScope(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) previewDocumentCommands(c *gin.Context) {
	var input document.CommandsInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Documents.PreviewCommands(c.Request.Context(), directoryScope(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) documentCommandReceipt(c *gin.Context) {
	result, err := h.deps.Documents.CommandReceipt(c.Request.Context(), directoryScope(c), c.Param("operation_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
