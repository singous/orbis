package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

type optional[T any] struct {
	Present bool
	Value   *T
}

// UnmarshalJSON distinguishes an omitted PATCH field from an explicit null.
func (o *optional[T]) UnmarshalJSON(data []byte) error {
	o.Present = true
	return json.Unmarshal(data, &o.Value)
}

func directoryScope(c *gin.Context) document.DirectoryScope {
	return document.DirectoryScope{
		ActorID: actor(c).UserID, WorkspaceID: c.Param("workspace_id"),
		CollectionID: c.Param("collection_id"), DocumentID: c.Param("document_id"),
	}
}

func archivedQuery(c *gin.Context) (bool, error) {
	values, exists := c.Request.URL.Query()["archived"]
	if !exists {
		return false, nil
	}
	if len(values) != 1 || (values[0] != "true" && values[0] != "false") {
		return false, fault.Field("query.archived", "archived 必须是 true 或 false")
	}
	return values[0] == "true", nil
}

func parentQuery(c *gin.Context) (*string, error) {
	values, exists := c.Request.URL.Query()["parent_id"]
	if !exists {
		return nil, nil
	}
	if len(values) != 1 {
		return nil, fault.Field("query.parent_id", "父文档 ID 只能出现一次")
	}
	id, err := uuid.Parse(values[0])
	if err != nil || id == uuid.Nil || id.String() != values[0] {
		return nil, fault.Field("query.parent_id", "父文档 ID 必须是标准 UUID")
	}
	return &values[0], nil
}

func (h *handler) collection(c *gin.Context) {
	item, err := h.deps.Documents.Collection(c.Request.Context(), directoryScope(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, collectionResponse(item))
}

func (h *handler) children(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	parent, err := parentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Documents.Children(c.Request.Context(), document.ChildrenQuery{
		Scope: directoryScope(c), ParentID: parent, Page: page,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]documentDTO, 0, len(result.Items))
	for _, item := range result.Items {
		rows = append(rows, h.documentResponse(item))
	}
	success(c, http.StatusOK, gin.H{
		"items": rows, "directory_version": result.DirectoryVersion,
		"pagination": pageInfo{Page: page.Number, PageSize: page.Size, Total: result.Total},
	})
}

func (h *handler) archivedDocuments(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Documents.Archived(c.Request.Context(), directoryScope(c), page)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]documentDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, h.documentResponse(item))
	}
	listResponse(
		c,
		rows,
		total,
		page,
	)
}

func (h *handler) directoryMutationResponse(c *gin.Context, result document.DirectoryMutation) {
	success(
		c,
		http.StatusOK,
		gin.H{"document": h.documentResponse(result.Document), "directory_version": result.DirectoryVersion},
	)
}

func (h *handler) moveDocument(c *gin.Context) {
	var input struct {
		ExpectedDirectoryVersion int64            `json:"expected_directory_version"`
		ParentID                 optional[string] `json:"parent_id"`
		Position                 optional[int]    `json:"position"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if input.Position.Present && input.Position.Value == nil {
		h.fail(c, fault.Field("body.position", "position 不能为 null"))
		return
	}
	result, err := h.deps.Documents.Move(c.Request.Context(), document.LocationChange{
		Scope: directoryScope(c), ExpectedDirectoryVersion: input.ExpectedDirectoryVersion,
		ParentSet: input.ParentID.Present, ParentID: input.ParentID.Value, Position: input.Position.Value,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	h.directoryMutationResponse(c, result)
}

func (h *handler) reorderDocuments(c *gin.Context) {
	var input struct {
		ExpectedDirectoryVersion int64     `json:"expected_directory_version"`
		ParentID                 *string   `json:"parent_id"`
		DocumentIDs              *[]string `json:"document_ids"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if input.DocumentIDs == nil {
		h.fail(c, fault.Field("body.document_ids", "document_ids 必须是数组"))
		return
	}
	result, err := h.deps.Documents.Reorder(c.Request.Context(), document.ReorderChange{
		Scope: directoryScope(c), ExpectedDirectoryVersion: input.ExpectedDirectoryVersion,
		ParentID: input.ParentID, DocumentIDs: *input.DocumentIDs,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, collectionResponse(result))
}

func archiveInput(c *gin.Context) (document.ArchiveChange, error) {
	var input struct {
		Archived                 *bool `json:"archived"`
		ExpectedDirectoryVersion int64 `json:"expected_directory_version"`
	}
	if err := decode(c, &input); err != nil {
		return document.ArchiveChange{}, err
	}
	if input.Archived == nil {
		return document.ArchiveChange{}, fault.Field("body.archived", "archived 必须是布尔值")
	}
	return document.ArchiveChange{
		Scope: directoryScope(c), Archived: *input.Archived, ExpectedDirectoryVersion: input.ExpectedDirectoryVersion,
	}, nil
}

func (h *handler) archiveDocument(c *gin.Context) {
	input, err := archiveInput(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Documents.Archive(c.Request.Context(), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	h.directoryMutationResponse(c, result)
}

func (h *handler) archiveCollection(c *gin.Context) {
	input, err := archiveInput(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Documents.ArchiveCollection(c.Request.Context(), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, collectionResponse(result))
}
