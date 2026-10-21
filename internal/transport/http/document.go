package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
)

func (h *handler) collections(c *gin.Context) {
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
	groupID, err := groupQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Documents.Collections(c.Request.Context(), document.CollectionQuery{
		Scope: directoryScope(c), Page: page, Archived: archived, GroupID: groupID,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]collectionDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, collectionResponse(item))
	}
	listResponse(
		c,
		rows,
		total,
		page,
	)
}

func (h *handler) createCollection(c *gin.Context) {
	var input struct {
		Icon      *document.CollectionIcon `json:"icon"`
		Title     string                   `json:"title"`
		GroupID   *string                  `json:"group_id"`
		SortOrder optional[int]            `json:"sort_order"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if err := nonNull("sort_order", input.SortOrder); err != nil {
		h.fail(c, err)
		return
	}
	order := 0
	if input.SortOrder.Value != nil {
		order = *input.SortOrder.Value
	}
	item, err := h.deps.Documents.CreateCollection(c.Request.Context(), document.CollectionInput{Icon: input.Icon, Scope: directoryScope(c), Title: input.Title, GroupID: input.GroupID, SortOrder: order})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, collectionResponse(item))
}

func (h *handler) documents(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Documents.List(
		c.Request.Context(),
		actor(c).UserID,
		c.Param("workspace_id"),
		c.Param("collection_id"),
		page,
	)
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

func (h *handler) createDocument(c *gin.Context) {
	var input struct {
		Title    string  `json:"title"`
		ParentID *string `json:"parent_id"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	item, err := h.deps.Documents.Create(c.Request.Context(), document.CreateInput{
		Scope: directoryScope(c), Title: input.Title, ParentID: input.ParentID,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, h.documentResponse(item))
}

func (h *handler) document(c *gin.Context) {
	item, err := h.deps.Documents.Get(
		c.Request.Context(),
		actor(c).UserID,
		c.Param("workspace_id"),
		c.Param("document_id"),
	)
	if err != nil {
		h.fail(c, err)
		return
	}
	result := h.documentResponse(item)
	result.CollaborationAvailable = h.deps.Documents.CollaborationAvailable()
	success(c, http.StatusOK, result)
}

func (h *handler) content(c *gin.Context) {
	version, err := integerQuery(c, "version", 0)
	if err != nil {
		h.fail(c, err)
		return
	}
	item, err := h.deps.Documents.Read(
		c.Request.Context(),
		actor(c).UserID,
		c.Param("workspace_id"),
		c.Param("document_id"),
		version,
	)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, contentResponse(item))
}

func (h *handler) writeContent(c *gin.Context) {
	var input struct {
		OperationID     string            `json:"operation_id"`
		ExpectedVersion int64             `json:"expected_version"`
		Title           string            `json:"title"`
		Blocks          *[]document.Block `json:"blocks"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if input.Blocks == nil {
		h.fail(c, fault.Field("body.blocks", "blocks 必须是数组"))
		return
	}
	item, err := h.deps.Documents.Write(
		c.Request.Context(),
		actor(c).UserID,
		c.Param("workspace_id"),
		c.Param("document_id"),
		document.Change{
			OperationID:     input.OperationID,
			ExpectedVersion: input.ExpectedVersion,
			Title:           input.Title,
			Blocks:          *input.Blocks,
		},
	)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, contentResponse(item))
}

func (h *handler) revisions(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Documents.Revisions(
		c.Request.Context(),
		actor(c).UserID,
		c.Param("workspace_id"),
		c.Param("document_id"),
		page,
	)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]revisionDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, revisionResponse(item))
	}
	listResponse(
		c,
		rows,
		total,
		page,
	)
}

func (h *handler) restore(c *gin.Context) {
	var input struct {
		OperationID     string `json:"operation_id"`
		ExpectedVersion int64  `json:"expected_version"`
		SourceVersion   int64  `json:"source_version"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	item, err := h.deps.Documents.Restore(
		c.Request.Context(),
		actor(c).UserID,
		c.Param("workspace_id"),
		c.Param("document_id"),
		input.OperationID,
		input.ExpectedVersion,
		input.SourceVersion,
	)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, contentResponse(item))
}

type blockRecordDTO struct {
	BlockRevision int64             `json:"block_revision"`
	ChildCount    int               `json:"child_count"`
	ID            string            `json:"id"`
	ParentID      *string           `json:"parent_id"`
	Position      int               `json:"position"`
	Payload       *document.Payload `json:"payload"`
	BlockType     string            `json:"block_type"`
	PayloadLoaded bool              `json:"payload_loaded"`
	PayloadBytes  int               `json:"payload_bytes"`
}

func (h *handler) blocks(c *gin.Context) {
	version, err := integerQuery(c, "version", 0)
	if err != nil {
		h.fail(c, err)
		return
	}
	size, err := integerQuery(c, "page_size", pagination.DefaultSize)
	if err != nil {
		h.fail(c, err)
		return
	}
	if size > pagination.MaxSize {
		h.fail(c, fault.Field("query.page_size", "每页数量不能超过 100"))
		return
	}
	items, next, more, resolved, err := h.deps.Documents.Blocks(
		c.Request.Context(),
		actor(c).UserID,
		c.Param("workspace_id"),
		c.Param("document_id"),
		version,
		c.Query("cursor"),
		int(size),
	)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows, err := blockWindowResponse(items)
	if err != nil {
		h.fail(c, err)
		return
	}

	success(c, http.StatusOK, gin.H{
		"items": rows, "version": resolved, "pagination": gin.H{"next_cursor": next, "has_more": more},
	})
}

func (h *handler) workspaceDocuments(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Documents.Browse(c.Request.Context(), directoryScope(c), page)
	if err != nil {
		h.fail(c, err)
		return
	}
	type overviewDTO struct {
		documentDTO
		Summary string `json:"summary"`
	}
	rows := make([]overviewDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, overviewDTO{documentDTO: h.documentResponse(item.Document), Summary: item.Summary})
	}
	listResponse(c, rows, total, page)
}
