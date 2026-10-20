package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"orbis.local/orbis/api"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/markdown"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/platform/fault"
)

func (h *handler) agentMe(c *gin.Context) {
	p := integrationPrincipal(c)
	success(c, http.StatusOK, gin.H{"user_id": p.UserID, "display_name": p.DisplayName, "workspace_id": p.Token.WorkspaceID, "workspace_name": p.WorkspaceName, "role": p.Role, "token_id": p.Token.ID, "token_name": p.Token.Name, "permissions": p.Permissions})
}
func (h *handler) agentCapabilities(c *gin.Context) {
	p := integrationPrincipal(c)
	success(c, http.StatusOK, gin.H{"protocol_version": "2.0", "content_schema": "orbis.blocks.v1", "permissions": p.Permissions, "scope": gin.H{"workspace_id": p.Token.WorkspaceID, "collection_id": p.Token.CollectionID, "document_id": p.Token.DocumentID}, "limits": gin.H{"page_size": 100, "operations": document.MaxOperations, "operation_bytes": document.MaxAgentOperationBytes, "document_bytes": document.MaxContentBytes, "export_bytes": markdown.MaxExportBytes}, "operations": []string{"update_block", "replace_text", "insert_blocks", "move_block", "delete_block", "update_metadata"}, "features": gin.H{"read": true, "preview": true, "idempotency": true, "create": true, "files": true, "live_shares": true, "large_markdown_import": h.deps.Imports.Enabled(), "sites": false, "datasets": false}})
}
func (h *handler) agentSchema(c *gin.Context) {
	var contract map[string]any
	if err := json.Unmarshal(api.Contract, &contract); err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"protocol_version": "2.0", "content_schema": "orbis.blocks.v1", "openapi": contract})
}
func agentQuery(c *gin.Context) (integration.LibraryQuery, error) {
	q := integration.LibraryQuery{Principal: integrationPrincipal(c), DocumentID: c.Param("document_id"), BlockID: c.Param("block_id")}
	var err error
	q.Page, err = pageQuery(c)
	if err != nil {
		return q, err
	}
	q.Limit = q.Page.Size
	q.Version, err = integerQuery(c, "version", 0)
	if err != nil {
		return q, err
	}
	q.Cursor, err = singleQuery(c, "cursor", "")
	return q, err
}
func (h *handler) agentCollections(c *gin.Context) {
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Library.Collections(c.Request.Context(), q)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]collectionDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, collectionResponse(item))
	}
	listResponse(c, rows, total, q.Page)
}
func (h *handler) agentDocuments(c *gin.Context) {
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	if _, exists := c.Request.URL.Query()["collection_id"]; exists {
		value, err := singleQuery(c, "collection_id", "")
		if err != nil {
			h.fail(c, err)
			return
		}
		q.CollectionID = &value
	}
	q.Text, err = singleQuery(c, "q", "")
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Library.Documents(c.Request.Context(), q)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]documentDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, h.documentResponse(item))
	}
	listResponse(c, rows, total, q.Page)
}
func (h *handler) agentResolve(c *gin.Context) {
	var input struct {
		DocumentID *string `json:"document_id"`
		Title      *string `json:"title"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if (input.DocumentID == nil) == (input.Title == nil) {
		h.fail(c, fault.Field("body", "需要提供 document_id 或 title 其中一项"))
		return
	}
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	if input.DocumentID != nil {
		q.DocumentID = *input.DocumentID
	}
	q.ExactTitle = input.Title
	items, total, err := h.deps.Library.Documents(c.Request.Context(), q)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]documentDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, h.documentResponse(item))
	}
	listResponse(c, rows, total, q.Page)
}
func (h *handler) agentDocument(c *gin.Context) {
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.Document(c.Request.Context(), q)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, h.documentResponse(result))
}
func (h *handler) agentContent(c *gin.Context) {
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.Content(c.Request.Context(), q)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, contentResponse(result))
}
func (h *handler) agentBlocks(c *gin.Context) {
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	kind := "flat"
	if c.FullPath() == "/api/v1/agent/workspaces/:workspace_id/documents/:document_id/children" {
		kind = "children"
		if _, exists := c.Request.URL.Query()["parent_id"]; exists {
			value, err := singleQuery(c, "parent_id", "")
			if err != nil {
				h.fail(c, err)
				return
			}
			q.ParentID = &value
		}
	}
	result, err := h.deps.Library.BlockWindow(c.Request.Context(), q, kind)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows, err := blockWindowResponse(result.Items)
	if err != nil {
		h.fail(c, err)
		return
	}

	success(c, http.StatusOK, gin.H{"version": result.Version, "items": rows, "pagination": gin.H{"next_cursor": result.NextCursor, "has_more": result.HasMore}})
}
func (h *handler) agentBlock(c *gin.Context) {
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, version, err := h.deps.Library.Block(c.Request.Context(), q)
	if err != nil {
		h.fail(c, err)
		return
	}
	row, err := blockResponse(result)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"version": version, "item": row})
}
func (h *handler) agentOutline(c *gin.Context) {
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.Outline(c.Request.Context(), q)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"version": result.Version, "items": result.Items, "pagination": gin.H{"next_cursor": result.NextCursor, "has_more": result.HasMore}})
}
func (h *handler) agentChanges(c *gin.Context) {
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	q.SinceVersion, err = integerQuery(c, "since_version", 0)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.Changes(c.Request.Context(), q)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"version": result.Version, "since_version": result.SinceVersion, "items": result.Items, "pagination": gin.H{"next_cursor": result.NextCursor, "has_more": result.HasMore}})
}
func (h *handler) agentApply(c *gin.Context) {
	var input document.CommandsInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.Apply(c.Request.Context(), integrationPrincipal(c), c.Param("document_id"), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) agentPreview(c *gin.Context) {
	var input document.CommandsInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.Preview(c.Request.Context(), integrationPrincipal(c), c.Param("document_id"), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) agentOperation(c *gin.Context) {
	result, err := h.deps.Library.Operation(c.Request.Context(), integrationPrincipal(c), c.Param("operation_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}

func (h *handler) agentCreate(c *gin.Context) {
	var input integration.CreateDocumentInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.Create(c.Request.Context(), integrationPrincipal(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, result)
}
func (h *handler) agentExport(c *gin.Context) {
	q, err := agentQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	format, err := singleQuery(c, "format", "json")
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Library.Export(c.Request.Context(), q, format)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}

func (h *handler) agentWorkspaces(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	p := integrationPrincipal(c)
	type summary struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Role string `json:"role"`
	}
	items := []summary{}
	if page.Number == 1 {
		items = append(items, summary{p.Token.WorkspaceID, p.WorkspaceName, string(p.Role)})
	}
	listResponse(c, items, 1, page)
}
