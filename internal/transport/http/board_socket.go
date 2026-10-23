package httpapi

import (
	"context"
	"time"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"

	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/platform/fault"
)

const boardSocketPath = "/api/v1/workspaces/:workspace_id/boards/:board_id/sync"
const boardSyncInterval = 250 * time.Millisecond
const boardAuthenticationBytes = 8 << 10

// The socket streams committed changes. Mutations retain their existing HTTP
// idempotency receipts, so a broken stream never changes persistence semantics.
func (h *handler) boardSocket(c *gin.Context) {
	owner := h.deps.CollaborationSockets
	if owner == nil || h.deps.Boards == nil {
		h.fail(c, fault.New(fault.Unavailable, "SERVICE_UNAVAILABLE", "服务暂时不可用"))
		return
	}
	conn, err := websocket.Accept(c.Writer, c.Request, &websocket.AcceptOptions{Subprotocols: []string{"orbis.board.v1"}, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	if !owner.add(conn) {
		_ = conn.Close(websocket.StatusTryAgainLater, "Collaboration capacity reached")
		return
	}
	defer owner.remove(conn)
	conn.SetReadLimit(boardAuthenticationBytes)
	ctx, cancel := context.WithCancel(owner.ctx)
	defer cancel()
	bounded, stop := context.WithTimeout(ctx, collaborationIOTimeout)
	auth, err := socketRead(bounded, conn)
	stop()
	if err != nil {
		return
	}
	if auth.Type != "authenticate" || auth.ProtocolVersion != board.SchemaVersion || auth.AfterVersion < 1 || auth.AfterVersion > board.MaxVersion {
		_ = socketProblem(ctx, conn, "", fault.Field("protocol_version", "画板同步参数无效"))
		return
	}
	bounded, stop = context.WithTimeout(ctx, collaborationIOTimeout)
	actor, err := h.deps.Identity.Authenticate(bounded, auth.Token)
	stop()
	if err != nil {
		_ = socketProblem(ctx, conn, "", err)
		return
	}
	if !owner.identify(conn, actor.UserID) {
		_ = conn.Close(websocket.StatusTryAgainLater, "Collaboration user capacity reached")
		return
	}
	scope := board.Scope{ActorID: actor.UserID, WorkspaceID: c.Param("workspace_id"), BoardID: c.Param("board_id")}
	after := auth.AfterVersion
	// CloseRead owns the control-frame reader and cancels when the peer disconnects.
	readCtx := conn.CloseRead(ctx)
	poll := func() error {
		request, done := context.WithTimeout(readCtx, collaborationIOTimeout)
		defer done()
		current, err := h.deps.Identity.Authenticate(request, auth.Token)
		if err != nil {
			return err
		}
		if current != actor {
			return fault.Auth()
		}
		changes, err := h.deps.Boards.Changes(request, scope, after)
		if err != nil {
			return err
		}
		if len(changes.Items) == 0 {
			return nil
		}
		if err := socketWrite(readCtx, conn, map[string]any{"type": "changes", "data": changes}); err != nil {
			return err
		}
		after = changes.Items[len(changes.Items)-1].Revision
		return nil
	}
	if err := poll(); err != nil {
		_ = socketProblem(ctx, conn, "", err)
		return
	}
	if err := socketWrite(readCtx, conn, map[string]any{"type": "ready", "protocol_version": board.SchemaVersion}); err != nil {
		return
	}
	ticker := time.NewTicker(boardSyncInterval)
	defer ticker.Stop()
	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-readCtx.Done():
			return
		case <-ticker.C:
			if err := poll(); err != nil {
				_ = socketProblem(ctx, conn, "", err)
				return
			}
		case <-heartbeat.C:
			ping, done := context.WithTimeout(readCtx, collaborationIOTimeout)
			err := conn.Ping(ping)
			done()
			if err != nil {
				return
			}
		}
	}
}
