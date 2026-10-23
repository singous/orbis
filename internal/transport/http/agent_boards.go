package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"

	"orbis.local/orbis/api"
	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/integration"
)

func (h *handler) agentBoardRead(c *gin.Context, kind string) {
	revision, err := boardSequence(c, "revision")
	if err != nil {
		h.fail(c, err)
		return
	}
	afterName := "after"
	if kind == "history" {
		afterName = "before"
	}
	after, err := boardSequence(c, afterName)
	if err != nil {
		h.fail(c, err)
		return
	}
	page, err := pageQuery(c)
	if err != nil {
		h.fail(c, err)
		return
	}
	q := integration.BoardQuery{Principal: integrationPrincipal(c), BoardID: c.Param("board_id"), Revision: revision, After: after, Page: page, CollectionID: c.Query("collection_id"), OperationID: c.Param("operation_id"), Elements: board.ElementQuery{PageID: c.Param("page_id"), Revision: revision, Cursor: c.Query("cursor")}}
	result, err := h.deps.AgentBoards.Read(c.Request.Context(), q, kind)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
func (h *handler) agentBoardsList(c *gin.Context)    { h.agentBoardRead(c, "list") }
func (h *handler) agentBoardMetadata(c *gin.Context) { h.agentBoardRead(c, "metadata") }
func (h *handler) agentBoardSnapshot(c *gin.Context) { h.agentBoardRead(c, "snapshot") }
func (h *handler) agentBoardElements(c *gin.Context) { h.agentBoardRead(c, "elements") }
func (h *handler) agentBoardChanges(c *gin.Context)  { h.agentBoardRead(c, "changes") }
func (h *handler) agentBoardHistory(c *gin.Context)  { h.agentBoardRead(c, "history") }
func (h *handler) agentBoardReceipt(c *gin.Context)  { h.agentBoardRead(c, "receipt") }
func (h *handler) agentBoardCatalog(c *gin.Context) {
	success(c, http.StatusOK, json.RawMessage(api.BoardCatalog))
}
func (h *handler) agentBoardCreate(c *gin.Context) {
	var in board.Create
	if err := decode(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.AgentBoards.Create(c.Request.Context(), integrationPrincipal(c), in)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusCreated, result)
}
func (h *handler) agentBoardChange(c *gin.Context) {
	var in board.Mutation
	if err := decode(c, &in); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.AgentBoards.Change(c.Request.Context(), integrationPrincipal(c), c.Param("board_id"), in)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}

func (h *handler) agentBoardTemplates(c *gin.Context) {
	success(c, http.StatusOK, json.RawMessage(api.BoardTemplates))
}
