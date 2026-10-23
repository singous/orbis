package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/quicknote"
)

type quickNoteDTO struct {
	ID          string           `json:"id"`
	WorkspaceID string           `json:"workspace_id"`
	OwnerID     string           `json:"owner_id"`
	Version     int64            `json:"version"`
	Blocks      []document.Block `json:"blocks"`
	TagIDs      []string         `json:"tag_ids"`
	IsPinned    bool             `json:"is_pinned"`
	CreatedAtMS int64            `json:"created_at_ms"`
	UpdatedAtMS int64            `json:"updated_at_ms"`
	DeletedAtMS *int64           `json:"deleted_at_ms"`
}
type quickNoteTagDTO struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     int64  `json:"version"`
	Count       int64  `json:"count"`
	CreatedAtMS int64  `json:"created_at_ms"`
	UpdatedAtMS int64  `json:"updated_at_ms"`
}

func quickNoteResponse(n quicknote.Note) quickNoteDTO {
	return quickNoteDTO{n.ID, n.WorkspaceID, n.OwnerID, n.Version, n.Blocks, n.TagIDs, n.IsPinned, n.CreatedAtMS, n.UpdatedAtMS, n.DeletedAtMS}
}
func quickNoteTagResponse(t quicknote.Tag) quickNoteTagDTO {
	return quickNoteTagDTO{t.ID, t.Name, t.Version, t.Count, t.CreatedAtMS, t.UpdatedAtMS}
}
func quickNoteScope(c *gin.Context) quicknote.Scope {
	return quicknote.Scope{ActorID: actor(c).UserID, WorkspaceID: c.Param("workspace_id")}
}
func boolQuery(c *gin.Context, key string) (bool, error) {
	values, exists := c.Request.URL.Query()[key]
	if !exists {
		return false, nil
	}
	if len(values) != 1 || (values[0] != "true" && values[0] != "false") {
		return false, fault.Field("query."+key, "请使用 true 或 false")
	}
	return values[0] == "true", nil
}
func (h *handler) quickNotes(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	deleted, err := boolQuery(c, "deleted")
	if err != nil {
		h.fail(c, err)
		return
	}
	untagged, err := boolQuery(c, "untagged")
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.QuickNotes.List(c.Request.Context(), quicknote.Query{Scope: quickNoteScope(c), Page: page, Search: c.Query("q"), TagID: c.Query("tag_id"), Sort: c.Query("sort"), Untagged: untagged, Deleted: deleted})
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]quickNoteDTO, 0, len(items))
	for _, n := range items {
		rows = append(rows, quickNoteResponse(n))
	}
	listResponse(c, rows, total, page)
}
func (h *handler) quickNote(c *gin.Context) {
	n, err := h.deps.QuickNotes.Get(c.Request.Context(), quickNoteScope(c), c.Param("quick_note_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, quickNoteResponse(n))
}
func (h *handler) quickNoteSummary(c *gin.Context) {
	s, err := h.deps.QuickNotes.Summary(c.Request.Context(), quickNoteScope(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"total": s.Total, "untagged": s.Untagged, "deleted": s.Deleted})
}
func (h *handler) writeQuickNote(c *gin.Context) {
	var body struct {
		OperationID     string            `json:"operation_id"`
		ExpectedVersion *int64            `json:"expected_version"`
		Blocks          *[]document.Block `json:"blocks"`
		TagIDs          *[]string         `json:"tag_ids"`
	}
	if err := decode(c, &body); err != nil {
		h.fail(c, err)
		return
	}
	if body.Blocks == nil || body.TagIDs == nil {
		h.fail(c, fault.Field("body", "blocks 和 tag_ids 必须为数组"))
		return
	}
	if body.ExpectedVersion == nil {
		h.fail(c, fault.Field("body.expected_version", "请提供版本号"))
		return
	}
	input := quicknote.Change{OperationID: body.OperationID, ExpectedVersion: *body.ExpectedVersion, Blocks: body.Blocks, TagIDs: body.TagIDs}
	n, err := h.deps.QuickNotes.Save(c.Request.Context(), quickNoteScope(c), c.Param("quick_note_id"), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	status := http.StatusOK
	if c.Request.Method == http.MethodPost {
		status = http.StatusCreated
	}
	success(c, status, quickNoteResponse(n))
}
func (h *handler) patchQuickNote(c *gin.Context) {
	var body struct {
		OperationID     string         `json:"operation_id"`
		ExpectedVersion int64          `json:"expected_version"`
		IsPinned        optional[bool] `json:"is_pinned"`
		IsDeleted       optional[bool] `json:"is_deleted"`
	}
	if err := decode(c, &body); err != nil {
		h.fail(c, err)
		return
	}
	for name, value := range map[string]optional[bool]{"is_pinned": body.IsPinned, "is_deleted": body.IsDeleted} {
		if err := nonNull(name, value); err != nil {
			h.fail(c, err)
			return
		}
	}
	n, err := h.deps.QuickNotes.Save(c.Request.Context(), quickNoteScope(c), c.Param("quick_note_id"), quicknote.Change{OperationID: body.OperationID, ExpectedVersion: body.ExpectedVersion, IsPinned: body.IsPinned.Value, IsDeleted: body.IsDeleted.Value})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, quickNoteResponse(n))
}
func (h *handler) quickNoteTags(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	tags, total, err := h.deps.QuickNotes.Tags(c.Request.Context(), quickNoteScope(c), page)
	if err != nil {
		h.fail(c, err)
		return
	}
	rows := make([]quickNoteTagDTO, 0, len(tags))
	for _, tag := range tags {
		rows = append(rows, quickNoteTagResponse(tag))
	}
	listResponse(c, rows, total, page)
}
func (h *handler) writeQuickNoteTag(c *gin.Context) {
	var body struct {
		OperationID     string `json:"operation_id"`
		ExpectedVersion *int64 `json:"expected_version"`
		Name            string `json:"name"`
	}
	if err := decode(c, &body); err != nil {
		h.fail(c, err)
		return
	}
	if body.ExpectedVersion == nil {
		h.fail(c, fault.Field("body.expected_version", "请提供版本号"))
		return
	}
	tag, err := h.deps.QuickNotes.SaveTag(c.Request.Context(), quickNoteScope(c), c.Param("tag_id"), quicknote.TagChange{Name: body.Name, OperationID: body.OperationID, ExpectedVersion: *body.ExpectedVersion, Delete: c.Request.Method == http.MethodDelete})
	if err != nil {
		h.fail(c, err)
		return
	}
	if c.Request.Method == http.MethodDelete {
		success[any](c, http.StatusOK, nil)
		return
	}
	status := http.StatusOK
	if c.Request.Method == http.MethodPost {
		status = http.StatusCreated
	}
	success(c, status, quickNoteTagResponse(tag))
}
func (h *handler) uploadQuickNoteAsset(c *gin.Context) {
	part, reader, err := uploadPart(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	row, err := h.deps.Assets.UploadPrivateFile(c.Request.Context(), assetScope(c), part.FileName(), part.Header.Get("Content-Type"), reader)
	if err != nil {
		h.fail(c, uploadFailure(err))
		return
	}
	success(c, http.StatusCreated, assetResponse(row))
}
func (h *handler) quickNoteAssetContent(c *gin.Context) {
	secureContentHeaders(c)
	row, err := h.deps.Assets.PrivateFile(c.Request.Context(), assetScope(c), c.Param("asset_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	h.deliverAsset(c, row)
}
