package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/platform/fault"
)

func (h *handler) agentUpload(c *gin.Context) {
	operation, err := singleQuery(c, "operation_id", "")
	if err != nil {
		h.fail(c, err)
		return
	}
	digest, err := singleQuery(c, "sha256", "")
	if err != nil {
		h.fail(c, err)
		return
	}
	sizeText, err := singleQuery(c, "size_bytes", "")
	if err != nil {
		h.fail(c, err)
		return
	}
	size, err := strconv.ParseInt(sizeText, 10, 64)
	if err != nil || size < 0 {
		h.fail(c, fault.Field("query.size_bytes", "需要提供非负附件字节数"))
		return
	}
	part, reader, err := uploadPart(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.Upload(c.Request.Context(), integrationPrincipal(c), c.Param("document_id"), integration.UploadInput{OperationID: operation, SHA256: digest, SizeBytes: size, Filename: part.FileName(), MediaHint: part.Header.Get("Content-Type")}, reader)
	if err != nil {
		h.fail(c, uploadFailure(err))
		return
	}
	success(c, http.StatusCreated, result)
}
func (h *handler) agentFile(c *gin.Context) {
	result, err := h.deps.Library.File(c.Request.Context(), integrationPrincipal(c), c.Param("document_id"), c.Param("asset_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, integration.FileInfo(result))
}
func (h *handler) agentFileContent(c *gin.Context) {
	secureContentHeaders(c)
	result, err := h.deps.Library.File(c.Request.Context(), integrationPrincipal(c), c.Param("document_id"), c.Param("asset_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	h.deliverAsset(c, result)
}
