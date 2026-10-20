package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/sharing"
)

type shareDTO struct {
	ID             string  `json:"id"`
	CollectionID   string  `json:"collection_id"`
	RootDocumentID *string `json:"root_document_id"`
	Version        int64   `json:"version"`
	ExpiresAtMS    *int64  `json:"expires_at_ms"`
	RevokedAtMS    *int64  `json:"revoked_at_ms"`
	CreatedAtMS    int64   `json:"created_at_ms"`
	UpdatedAtMS    int64   `json:"updated_at_ms"`
	Path           *string `json:"path"`
}

func shareResponse(share sharing.Share, path *string) shareDTO {
	return shareDTO{ID: share.ID, CollectionID: share.CollectionID, RootDocumentID: share.RootDocumentID, Version: share.Version, ExpiresAtMS: share.ExpiresAtMS, RevokedAtMS: share.RevokedAtMS, CreatedAtMS: share.CreatedAtMS, UpdatedAtMS: share.UpdatedAtMS, Path: path}
}
func shareScope(c *gin.Context) sharing.Scope {
	return sharing.Scope{ActorID: actor(c).UserID, WorkspaceID: c.Param("workspace_id"), ShareID: c.Param("share_id")}
}
func (h *handler) createShare(c *gin.Context) {
	privatePublicHeaders(c)
	var input sharing.CreateInput
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Sharing.Create(c.Request.Context(), shareScope(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, gin.H{"share": shareResponse(result.Share, &result.Path), "token": result.Token, "path": result.Path})
}
func (h *handler) shares(c *gin.Context) {
	privatePublicHeaders(c)
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	input := sharing.ListQuery{Scope: shareScope(c), Page: page}
	if _, exists := c.Request.URL.Query()["collection_id"]; exists {
		value, err := singleQuery(c, "collection_id", "")
		if err != nil {
			h.fail(c, err)
			return
		}
		input.CollectionID = &value
	}
	if _, exists := c.Request.URL.Query()["root_document_id"]; exists {
		value, err := singleQuery(c, "root_document_id", "")
		if err != nil {
			h.fail(c, err)
			return
		}
		input.RootSet = true
		if value != "none" {
			input.RootDocumentID = &value
		}
	}
	items, total, err := h.deps.Sharing.List(c.Request.Context(), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]shareDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, shareResponse(item.Share, item.Path))
	}
	listResponse(c, rows, total, page)
}
func (h *handler) revokeShare(c *gin.Context) {
	privatePublicHeaders(c)
	var input struct {
		ExpectedVersion int64 `json:"expected_version"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Sharing.Revoke(c.Request.Context(), shareScope(c), input.ExpectedVersion)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, shareResponse(result, nil))
}
func sharedQuery(c *gin.Context) (sharing.PublicQuery, error) {
	result := sharing.PublicQuery{Token: c.Param("token"), DocumentID: c.Param("document_id"), BlockID: c.Param("block_id"), TableID: c.Param("table_id"), AssetID: c.Param("asset_id")}
	var err error
	result.Version, err = integerQuery(c, "version", 0)
	return result, err
}
func (h *handler) shareDirectory(c *gin.Context) {
	privatePublicHeaders(c)
	query, err := sharedQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	query.Page, err = pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	query.DirectoryVersion, err = integerQuery(c, "directory_version", 0)
	if err != nil {
		h.fail(c, err)
		return
	}
	if _, exists := c.Request.URL.Query()["parent_id"]; exists {
		value, err := singleQuery(c, "parent_id", "")
		if err != nil {
			h.fail(c, err)
			return
		}
		query.ParentID = &value
	}
	result, err := h.deps.Sharing.Directory(c.Request.Context(), query)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"title": result.Title, "root_document_id": result.RootDocumentID, "directory_version": result.DirectoryVersion, "items": result.Items, "pagination": pageInfo{Page: query.Page.Number, PageSize: query.Page.Size, Total: result.Total}})
}
func (h *handler) sharedDocument(c *gin.Context) {
	privatePublicHeaders(c)
	query, err := sharedQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Sharing.Document(c.Request.Context(), query)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) sharedContent(c *gin.Context) {
	privatePublicHeaders(c)
	query, err := sharedQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Sharing.Content(c.Request.Context(), query)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"document": result.Document, "blocks": result.Blocks})
}
func (h *handler) sharedBlocks(c *gin.Context) {
	privatePublicHeaders(c)
	query, err := sharedQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	limit, err := integerQuery(c, "page_size", pagination.DefaultSize)
	if err != nil {
		h.fail(c, err)
		return
	}
	if limit > pagination.MaxSize {
		limit = pagination.MaxSize + 1
	}
	query.Limit = int(limit)
	cursor, err := singleQuery(c, "cursor", "")
	if err != nil {
		h.fail(c, err)
		return
	}
	result, next, more, err := h.deps.Sharing.Blocks(c.Request.Context(), query, cursor)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"document": result.Document, "items": result.Items, "pagination": gin.H{"next_cursor": next, "has_more": more}})
}
func (h *handler) sharedBlock(c *gin.Context) {
	privatePublicHeaders(c)
	query, err := sharedQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Sharing.Block(c.Request.Context(), query)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) sharedAsset(c *gin.Context) {
	privatePublicHeaders(c)
	query, err := sharedQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Sharing.Asset(c.Request.Context(), query)
	if err != nil {
		h.fail(c, err)
		return
	}
	h.deliverAsset(c, result)
}
func (h *handler) sharedTable(c *gin.Context) {
	privatePublicHeaders(c)
	query, err := sharedQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	query.Page, err = pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Sharing.Table(c.Request.Context(), query)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"document": result.Document, "title": result.Title, "fields": result.Fields, "view": result.View, "groups": result.Groups, "items": result.Items, "pagination": pageInfo{Page: query.Page.Number, PageSize: query.Page.Size, Total: result.Total}})
}

func (h *handler) sharedChildren(c *gin.Context) {
	privatePublicHeaders(c)
	query, err := sharedQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	limit, err := integerQuery(c, "page_size", pagination.DefaultSize)
	if err != nil {
		h.fail(c, err)
		return
	}
	if limit > pagination.MaxSize {
		limit = pagination.MaxSize + 1
	}
	query.Limit = int(limit)
	if _, exists := c.Request.URL.Query()["parent_id"]; exists {
		value, err := singleQuery(c, "parent_id", "")
		if err != nil {
			h.fail(c, err)
			return
		}
		query.ParentID = &value
	}
	cursor, err := singleQuery(c, "cursor", "")
	if err != nil {
		h.fail(c, err)
		return
	}
	result, next, more, err := h.deps.Sharing.Children(c.Request.Context(), query, cursor)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"document": result.Document, "items": result.Items, "pagination": gin.H{"next_cursor": next, "has_more": more}})
}
