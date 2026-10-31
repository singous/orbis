package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/sheet"
)

func sheetScope(c *gin.Context) sheet.Scope {
	return sheet.Scope{WorkspaceID: c.Param("workspace_id"), ActorID: actor(c).UserID, SheetID: c.Param("sheet_id")}
}
func sheetQuery(c *gin.Context) (sheet.Query, error) {
	limit, err := integerQuery(c, "limit", sheet.PageSize)
	if err != nil {
		return sheet.Query{}, err
	}
	q := sheet.Query{ViewID: c.Query("view"), Cursor: c.Query("cursor"), Search: c.Query("search"), Limit: int(limit)}
	for key, values := range c.Request.URL.Query() {
		if len(values) != 1 {
			return q, sheet.Invalid("查询参数不能重复")
		}
		switch key {
		case "view", "cursor", "search", "group", "limit":
		default:
			return q, sheet.Invalid("不支持的查询参数")
		}
	}
	if values, ok := c.Request.URL.Query()["group"]; ok {
		q.Group = &values[0]
	}
	return q, nil
}

func (h *handler) listSheets(c *gin.Context) {
	v, e := h.deps.Sheets.List(c.Request.Context(), sheetScope(c), c.Query("collection_id"), c.Query("cursor"))
	if e != nil {
		h.fail(c, e)
		return
	}
	success(c, http.StatusOK, v)
}
func (h *handler) createSheet(c *gin.Context) {
	var in sheet.Create
	if e := decode(c, &in); e != nil {
		h.fail(c, e)
		return
	}
	v, e := h.deps.Sheets.Create(c.Request.Context(), sheetScope(c), in)
	if e != nil {
		h.fail(c, e)
		return
	}
	success(c, http.StatusCreated, v)
}
func (h *handler) getSheet(c *gin.Context) {
	v, e := h.deps.Sheets.Get(c.Request.Context(), sheetScope(c))
	if e != nil {
		h.fail(c, e)
		return
	}
	success(c, http.StatusOK, v)
}
func (h *handler) updateSheet(c *gin.Context) {
	var in sheet.Update
	if e := decode(c, &in); e != nil {
		h.fail(c, e)
		return
	}
	v, e := h.deps.Sheets.Update(c.Request.Context(), sheetScope(c), in)
	if e != nil {
		h.fail(c, e)
		return
	}
	success(c, http.StatusOK, v)
}
func (h *handler) sheetRecords(c *gin.Context) {
	q, e := sheetQuery(c)
	if e != nil {
		h.fail(c, e)
		return
	}
	v, e := h.deps.Sheets.Records(c.Request.Context(), sheetScope(c), q)
	if e != nil {
		h.fail(c, e)
		return
	}
	success(c, http.StatusOK, v)
}
func (h *handler) sheetStats(c *gin.Context) {
	q, e := sheetQuery(c)
	if e != nil {
		h.fail(c, e)
		return
	}
	v, e := h.deps.Sheets.Stats(c.Request.Context(), sheetScope(c), q)
	if e != nil {
		h.fail(c, e)
		return
	}
	success(c, http.StatusOK, v)
}
func (h *handler) changeSheet(c *gin.Context) {
	var in sheet.Changes
	if e := decode(c, &in); e != nil {
		h.fail(c, e)
		return
	}
	v, e := h.deps.Sheets.Change(c.Request.Context(), sheetScope(c), in)
	if e != nil {
		h.fail(c, e)
		return
	}
	success(c, http.StatusOK, v)
}
func (h *handler) sheetForms(c *gin.Context) {
	v, e := h.deps.Sheets.Forms(c.Request.Context(), sheetScope(c))
	if e != nil {
		h.fail(c, e)
		return
	}
	success(c, http.StatusOK, gin.H{"items": v})
}
func (h *handler) saveSheetForm(c *gin.Context) {
	var in sheet.Form
	if e := decode(c, &in); e != nil {
		h.fail(c, e)
		return
	}
	v, e := h.deps.Sheets.SaveForm(c.Request.Context(), sheetScope(c), in)
	if e != nil {
		h.fail(c, e)
		return
	}
	success(c, http.StatusOK, v)
}
func (h *handler) publicSheetForm(c *gin.Context) {
	v, e := h.deps.Sheets.PublicForm(c.Request.Context(), c.Param("token"))
	if e != nil {
		h.fail(c, e)
		return
	}
	success(c, http.StatusOK, v)
}
func (h *handler) submitSheetForm(c *gin.Context) {
	var in sheet.Submission
	if e := decode(c, &in); e != nil {
		h.fail(c, e)
		return
	}
	if e := h.deps.Sheets.Submit(c.Request.Context(), c.Param("token"), in); e != nil {
		h.fail(c, e)
		return
	}
	success(c, http.StatusOK, gin.H{"submitted": true})
}

func (h *handler) uploadSheetForm(c *gin.Context) {
	scope, err := h.deps.Sheets.UploadScope(c.Request.Context(), c.Param("token"), c.Param("field_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	part, reader, err := uploadPart(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	row, err := h.deps.Assets.Upload(c.Request.Context(), asset.Scope{WorkspaceID: scope.WorkspaceID, ActorID: scope.ActorID}, part.FileName(), part.Header.Get("Content-Type"), reader)
	if err != nil {
		h.fail(c, uploadFailure(err))
		return
	}
	if err := h.deps.Sheets.RegisterUpload(c.Request.Context(), c.Param("token"), c.Param("field_id"), row.ID); err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, gin.H{"id": row.ID, "filename": row.Filename})
}
