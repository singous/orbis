package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
)

const collaborationSocketPath = "/api/v1/workspaces/:workspace_id/documents/:document_id/collaboration/socket"
const maxCollaborationConnections = 32
const maxCollaborationUserConnections = 8
const collaborationPollInterval = 500 * time.Millisecond
const collaborationIOTimeout = 10 * time.Second
const collaborationEnvelopeBytes = 4 << 20

type collaborationSocketMessage struct {
	Type            string                         `json:"type"`
	Token           string                         `json:"token,omitempty"`
	ProtocolVersion int                            `json:"protocol_version,omitempty"`
	AfterVersion    int64                          `json:"after_version,omitempty"`
	OperationID     string                         `json:"operation_id,omitempty"`
	Epoch           string                         `json:"epoch,omitempty"`
	Update          []byte                         `json:"update,omitempty"`
	TableCopies     []document.TableCopy           `json:"table_copies,omitempty"`
	Targets         []document.CollaborationTarget `json:"targets,omitempty"`
}

// CollaborationSockets owns every upgraded connection and its reader goroutine.
// The application closes this owner before releasing database or engine resources.
type CollaborationSockets struct {
	ctx         context.Context
	cancel      context.CancelFunc
	mu          sync.Mutex
	closed      bool
	connections map[*websocket.Conn]string
	users       map[string]int
	group       sync.WaitGroup
}

func NewCollaborationSockets() *CollaborationSockets {
	// This is an application-owned lifetime, independent of any startup/request timeout.
	ctx, cancel := context.WithCancel(context.Background())
	return &CollaborationSockets{ctx: ctx, cancel: cancel, connections: map[*websocket.Conn]string{}, users: map[string]int{}}
}
func (s *CollaborationSockets) add(conn *websocket.Conn) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || len(s.connections) >= maxCollaborationConnections {
		return false
	}
	s.connections[conn] = ""
	s.group.Add(1)
	return true
}
func (s *CollaborationSockets) identify(conn *websocket.Conn, user string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.users[user] >= maxCollaborationUserConnections {
		return false
	}
	s.connections[conn] = user
	s.users[user]++
	return true
}
func (s *CollaborationSockets) remove(conn *websocket.Conn) {
	s.mu.Lock()
	user := s.connections[conn]
	delete(s.connections, conn)
	if user != "" {
		s.users[user]--
		if s.users[user] == 0 {
			delete(s.users, user)
		}
	}
	s.mu.Unlock()
	s.group.Done()
}
func (s *CollaborationSockets) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.cancel()
	for conn := range s.connections {
		_ = conn.CloseNow()
	}
	s.mu.Unlock()
	s.group.Wait()
}

func (h *handler) enableDocumentCollaboration(c *gin.Context) {
	state, err := h.deps.Documents.EnableCollaboration(c.Request.Context(), directoryScope(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, state)
}
func (h *handler) documentCollaboration(c *gin.Context) {
	state, _, err := h.deps.Documents.ReadCollaboration(c.Request.Context(), directoryScope(c), 0)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, state)
}

func (h *handler) updateDocumentCollaboration(c *gin.Context) {
	var input document.CollaborationUpdate
	if err := decode(c, &input); err != nil {
		h.fail(c, err)
		return
	}
	result, err := h.deps.Documents.ApplyCollaboration(c.Request.Context(), directoryScope(c), input)
	if err != nil {
		h.fail(c, err)
		return
	}
	success(c, http.StatusOK, result)
}

func socketWrite(ctx context.Context, conn *websocket.Conn, value any) error {
	bounded, cancel := context.WithTimeout(ctx, collaborationIOTimeout)
	defer cancel()
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return conn.Write(bounded, websocket.MessageText, data)
}
func socketRead(ctx context.Context, conn *websocket.Conn) (collaborationSocketMessage, error) {
	var message collaborationSocketMessage
	kind, data, err := conn.Read(ctx)
	if err != nil {
		return message, err
	}
	if kind != websocket.MessageText {
		return message, fault.Field("message", "协同消息必须是 JSON 文本")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&message); err != nil {
		return message, fault.Field("message", "协同消息格式不正确")
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return message, fault.Field("message", "协同消息只能包含一个 JSON 对象")
	}
	return message, nil
}
func socketProblem(ctx context.Context, conn *websocket.Conn, operation string, err error) error {
	status, code, message := http.StatusServiceUnavailable, "COLLABORATION_UNAVAILABLE", "正文协同服务暂时不可用，本机修改仍保留"
	var business *fault.Error
	if errors.As(err, &business) {
		code, message = business.Code, business.Message
		switch business.Kind {
		case fault.Unauthenticated:
			status = http.StatusUnauthorized
		case fault.Forbidden:
			status = http.StatusForbidden
		case fault.NotFound:
			status = http.StatusNotFound
		case fault.Validation:
			status = http.StatusUnprocessableEntity
		case fault.Invalid:
			status = http.StatusBadRequest
		case fault.Conflict:
			status = http.StatusConflict
		case fault.TooLarge:
			status = http.StatusRequestEntityTooLarge
		}
	}
	problem := map[string]any{"type": "error", "status": status, "code": code, "message": message}
	if operation != "" {
		problem["operation_id"] = operation
	}
	return socketWrite(ctx, conn, problem)
}

func (h *handler) documentCollaborationSocket(c *gin.Context) {
	owner := h.deps.CollaborationSockets
	if owner == nil || !h.deps.Documents.CollaborationAvailable() {
		h.fail(c, document.CollaborationUnavailable())
		return
	}
	conn, err := websocket.Accept(c.Writer, c.Request, &websocket.AcceptOptions{Subprotocols: []string{"orbis.crdt.v1"}, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	if !owner.add(conn) {
		_ = conn.Close(websocket.StatusTryAgainLater, "Collaboration capacity reached")
		return
	}
	defer owner.remove(conn)
	conn.SetReadLimit(int64(document.MaxCollaborationUpdateBytes*4/3 + collaborationEnvelopeBytes))
	ctx, cancel := context.WithCancel(owner.ctx)
	defer cancel()
	initial, stop := context.WithTimeout(ctx, collaborationIOTimeout)
	auth, err := socketRead(initial, conn)
	stop()
	if err != nil {
		return
	}
	if auth.Type != "authenticate" || auth.ProtocolVersion != document.CollaborationProtocolVersion || auth.AfterVersion < 0 || auth.AfterVersion > document.MaxVersion {
		_ = socketProblem(ctx, conn, "", fault.Field("protocol_version", "协同协议版本不受支持"))
		return
	}
	authContext, stopAuth := context.WithTimeout(ctx, collaborationIOTimeout)
	actor, err := h.deps.Identity.Authenticate(authContext, auth.Token)
	stopAuth()
	if err != nil {
		_ = socketProblem(ctx, conn, "", err)
		return
	}
	if !owner.identify(conn, actor.UserID) {
		_ = conn.Close(websocket.StatusTryAgainLater, "Collaboration user capacity reached")
		return
	}
	scope := document.DirectoryScope{ActorID: actor.UserID, WorkspaceID: c.Param("workspace_id"), DocumentID: c.Param("document_id")}
	after := auth.AfterVersion
	poll := func() error {
		bounded, stop := context.WithTimeout(ctx, collaborationIOTimeout)
		defer stop()
		current, err := h.deps.Identity.Authenticate(bounded, auth.Token)
		if err != nil {
			return err
		}
		if current != actor {
			return fault.Auth()
		}
		state, changed, err := h.deps.Documents.ReadCollaboration(bounded, scope, after)
		if err != nil {
			return err
		}
		if changed {
			if err := socketWrite(ctx, conn, map[string]any{"type": "state", "data": state}); err != nil {
				return err
			}
			after = state.ContentVersion
		}
		return nil
	}
	if err := poll(); err != nil {
		_ = socketProblem(ctx, conn, "", err)
		return
	}
	if err := socketWrite(ctx, conn, map[string]any{"type": "ready", "protocol_version": document.CollaborationProtocolVersion}); err != nil {
		return
	}
	type readResult struct {
		message collaborationSocketMessage
		err     error
	}
	reads := make(chan readResult, 1)
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		for {
			message, err := socketRead(ctx, conn)
			select {
			case reads <- readResult{message: message, err: err}:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	defer func() { cancel(); _ = conn.CloseNow(); <-readerDone }()
	ticker := time.NewTicker(collaborationPollInterval)
	defer ticker.Stop()
	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case incoming := <-reads:
			if incoming.err != nil {
				return
			}
			message := incoming.message
			if message.Type != "update" || message.Token != "" {
				_ = socketProblem(ctx, conn, message.OperationID, fault.Field("type", "协同消息类型不受支持"))
				return
			}
			bounded, stop := context.WithTimeout(ctx, h.deps.RequestTimeout)
			_, err := h.deps.Identity.Authenticate(bounded, auth.Token)
			var result document.CollaborationResult
			if err == nil {
				result, err = h.deps.Documents.ApplyCollaboration(bounded, scope, document.CollaborationUpdate{OperationID: message.OperationID, Epoch: message.Epoch, Update: message.Update, TableCopies: message.TableCopies, Targets: message.Targets})
			}
			stop()
			if err != nil {
				if socketProblem(ctx, conn, message.OperationID, err) != nil {
					return
				}
				var failure *fault.Error
				if errors.As(err, &failure) && (failure.Kind == fault.Unauthenticated || failure.Kind == fault.Forbidden || failure.Kind == fault.NotFound) {
					return
				}
				continue
			}
			// Successful return means state, native projection, history and receipt all committed.
			if err := socketWrite(ctx, conn, map[string]any{"type": "ack", "operation_id": result.OperationID, "epoch": result.Epoch, "content_version": result.ContentVersion, "resolved_blocks": result.ResolvedBlocks}); err != nil {
				return
			}
			if err := poll(); err != nil {
				_ = socketProblem(ctx, conn, "", err)
				return
			}
		case <-ticker.C:
			if err := poll(); err != nil {
				_ = socketProblem(ctx, conn, "", err)
				return
			}
		case <-heartbeat.C:
			bounded, stop := context.WithTimeout(ctx, collaborationIOTimeout)
			err := conn.Ping(bounded)
			stop()
			if err != nil {
				return
			}
		}
	}
}
