package httpapi

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"orbis.local/orbis/internal/document"
)

func (h *handler) agentDocumentVersions(c *gin.Context) {
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.DocumentVersions(c.Request.Context(), q)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"items": result.Items, "pagination": result.Pagination, "automatic_history_enabled": h.deps.VersionHistoryEnabled})
}

func (h *handler) agentDocumentVersionContent(c *gin.Context) {
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	version, content, err := h.deps.Library.DocumentVersion(c.Request.Context(), q, c.Param("version_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"version": version, "content": contentResponse(content), "dependencies": version.Dependencies})
}

func (h *handler) agentCompareDocumentVersions(c *gin.Context) {
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	from, err := singleQuery(c, "from_id", "")
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.CompareDocumentVersions(c.Request.Context(), q, from, c.Param("version_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}

func (h *handler) agentSaveDocumentVersion(c *gin.Context) {
	var input document.CreateVersion
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.SaveDocumentVersion(c.Request.Context(), integrationPrincipal(c), c.Param("document_id"), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, result)
}

func (h *handler) agentEditDocumentVersion(c *gin.Context) {
	input, err := decodeVersionMetadata(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.EditDocumentVersion(c.Request.Context(), integrationPrincipal(c), c.Param("document_id"), c.Param("version_id"), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}

func (h *handler) agentRestoreDocumentVersion(c *gin.Context) {
	var input struct {
		OperationID      string `json:"operation_id"`
		ExpectedRevision int64  `json:"expected_revision"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.RestoreDocumentVersion(c.Request.Context(), integrationPrincipal(c), c.Param("document_id"), c.Param("version_id"), input.OperationID, input.ExpectedRevision)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, contentResponse(result))
}
