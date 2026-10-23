package httpapi

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"orbis.local/orbis/api"
	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/platform/fault"
)

func boardSequence(c *gin.Context, name string) (int64, error) {
	values, exists := c.Request.URL.Query()[name]
	if !exists {
		return 0, nil
	}
	if len(values) != 1 {
		return 0, fault.Field("query."+name, "查询参数不能重复")
	}
	value, err := strconv.ParseInt(values[0], 10, 64)
	if err != nil || value < 0 || value > board.MaxVersion {
		return 0, fault.Field("query."+name, "版本须为非负安全整数")
	}
	return value, nil
}

func boardScope(c *gin.Context) board.Scope {
	return board.Scope{ActorID: actor(c).UserID, WorkspaceID: c.Param("workspace_id"), BoardID: c.Param("board_id")}
}
func (h *handler) boardCatalog(c *gin.Context) {
	c.Data(http.StatusOK, "application/json; charset=utf-8", api.BoardCatalog)
}
func (h *handler) listBoards(c *gin.Context) {
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	items, total, err := h.deps.Boards.List(c.Request.Context(), boardScope(c), c.Query("collection_id"), page)
	if err != nil {
		h.fail(c, err)
		return
	}
	listResponse(c, items, total, page)
}
func (h *handler) createBoard(c *gin.Context) {
	var input board.Create
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Boards.Create(c.Request.Context(), boardScope(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, result)
}
func (h *handler) getBoard(c *gin.Context) {
	revision, err := boardSequence(c, "revision")
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Boards.Get(c.Request.Context(), boardScope(c), revision)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) boardElements(c *gin.Context) {
	revision, err := boardSequence(c, "revision")
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Boards.Elements(c.Request.Context(), boardScope(c), board.ElementQuery{PageID: c.Param("page_id"), Revision: revision, Cursor: c.Query("cursor")})
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) changeBoard(c *gin.Context) {
	var input board.Mutation
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Boards.Mutate(c.Request.Context(), boardScope(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) boardChanges(c *gin.Context) {
	after, err := boardSequence(c, "after")
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Boards.Changes(c.Request.Context(), boardScope(c), after)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) boardReceipt(c *gin.Context) {
	result, err := h.deps.Boards.Receipt(c.Request.Context(), boardScope(c), c.Param("operation_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) boardHistory(c *gin.Context) {
	before, err := boardSequence(c, "before")
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Boards.History(c.Request.Context(), boardScope(c), before)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, gin.H{"items": result})
}
func (h *handler) boardSnapshot(c *gin.Context) {
	revision, err := boardSequence(c, "revision")
	if err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Boards.Snapshot(c.Request.Context(), boardScope(c), revision)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
