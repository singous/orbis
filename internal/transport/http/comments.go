package httpapi

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"orbis.local/orbis/internal/document"
)

type commentDTO struct {
	ID           string  `json:"id"`
	WorkspaceID  string  `json:"workspace_id"`
	DocumentID   string  `json:"document_id"`
	AuthorID     string  `json:"author_id"`
	AuthorName   string  `json:"author_name"`
	ParentID     *string `json:"parent_id"`
	Body         string  `json:"body"`
	IsResolved   bool    `json:"is_resolved"`
	ResolvedAtMS *int64  `json:"resolved_at_ms"`
	Version      int64   `json:"version"`
	CreatedAtMS  int64   `json:"created_at_ms"`
	UpdatedAtMS  int64   `json:"updated_at_ms"`
}

func commentResponse(c document.Comment) commentDTO {
	return commentDTO{
		ID:           c.ID,
		WorkspaceID:  c.WorkspaceID,
		DocumentID:   c.DocumentID,
		AuthorID:     c.AuthorID,
		AuthorName:   c.AuthorName,
		ParentID:     c.ParentID,
		Body:         c.Body,
		IsResolved:   c.IsResolved,
		ResolvedAtMS: c.ResolvedAtMS,
		Version:      c.Version,
		CreatedAtMS:  c.CreatedAtMS,
		UpdatedAtMS:  c.UpdatedAtMS,
	}
}
func (h *handler) comments(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Comments.List(c.Request.Context(), directoryScope(c), page)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]commentDTO, 0, len(items))
	for _, item := range items {
		rows = append(rows, commentResponse(item))
	}
	listResponse(c, rows, total, page)
}
func (h *handler) createComment(c *gin.Context) {
	var input struct {
		Body     string  `json:"body"`
		ParentID *string `json:"parent_id"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	item, err := h.deps.Comments.Create(c.Request.Context(), document.CommentInput{Scope: directoryScope(c), Body: input.Body, ParentID: input.ParentID})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, commentResponse(item))
}
func (h *handler) updateComment(c *gin.Context) {
	var input struct {
		ExpectedVersion int64            `json:"expected_version"`
		Body            optional[string] `json:"body"`
		IsResolved      optional[bool]   `json:"is_resolved"`
	}
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	if err := nonNull("body", input.Body); err != nil {
		h.fail(c, err)
		return
	}
	if err := nonNull("is_resolved", input.IsResolved); err != nil {
		h.fail(c, err)
		return
	}
	item, err := h.deps.Comments.Update(c.Request.Context(), document.CommentChange{
		Scope:           directoryScope(c),
		CommentID:       c.Param("comment_id"),
		ExpectedVersion: input.ExpectedVersion,
		Body:            input.Body.Value,
		IsResolved:      input.IsResolved.Value,
	})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, commentResponse(item))
}
