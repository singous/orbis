package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
)

func versionPageQuery(c *gin.Context) (int, string, error) {
	size, err := integerQuery(c, "page_size", pagination.DefaultSize)
	if err != nil {
		return 0, "", err
	}
	if size < 1 || size > pagination.MaxSize {
		return 0, "", fault.Field("query.page_size", "每页数量必须在 1 至 100 之间")
	}
	cursor, err := singleQuery(c, "cursor", "")
	return int(size), cursor, err
}

func (h *handler) documentVersions(c *gin.Context) {
	limit, cursor, err := versionPageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Versions.List(c.Request.Context(), document.VersionQuery{Scope: directoryScope(c), Limit: limit}, cursor)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"items": result.Items, "pagination": result.Pagination, "automatic_history_enabled": h.deps.VersionHistoryEnabled})
}

func (h *handler) documentVersion(c *gin.Context) {
	result, err := h.deps.Versions.Get(c.Request.Context(), directoryScope(c), c.Param("version_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}

func (h *handler) createDocumentVersion(c *gin.Context) {
	var input document.CreateVersion
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Versions.Create(c.Request.Context(), directoryScope(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, result)
}

func decodeVersionMetadata(c *gin.Context) (document.EditVersion, error) {
	var input struct {
		OperationID             string           `json:"operation_id"`
		ExpectedMetadataVersion int64            `json:"expected_metadata_version"`
		Name                    optional[string] `json:"name"`
		Description             *string          `json:"description"`
	}
	if err := decode(c, &input); err != nil {
		return document.EditVersion{}, err
	}
	if !input.Name.Present || input.Description == nil {
		return document.EditVersion{}, fault.Field("body", "需要提供名称和说明，名称可为 null")
	}
	return document.EditVersion{OperationID: input.OperationID, ExpectedMetadataVersion: input.ExpectedMetadataVersion, Name: input.Name.Value, Description: *input.Description}, nil
}

func (h *handler) editDocumentVersion(c *gin.Context) {
	input, err := decodeVersionMetadata(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Versions.Edit(c.Request.Context(), directoryScope(c), c.Param("version_id"), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}

func (h *handler) documentVersionContent(c *gin.Context) {
	version, content, err := h.deps.Versions.Content(c.Request.Context(), directoryScope(c), c.Param("version_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"version": version, "content": contentResponse(content), "dependencies": version.Dependencies})
}

func (h *handler) restoreDocumentVersion(c *gin.Context) {
	var input struct {
		OperationID      string `json:"operation_id"`
		ExpectedRevision int64  `json:"expected_revision"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Versions.Restore(c.Request.Context(), directoryScope(c), c.Param("version_id"), input.OperationID, input.ExpectedRevision)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, contentResponse(result))
}

func (h *handler) compareDocumentVersions(c *gin.Context) {
	limit, cursor, err := versionPageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	from, err := singleQuery(c, "from_id", "")
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Versions.Compare(c.Request.Context(), directoryScope(c), from, c.Param("version_id"), cursor, limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
