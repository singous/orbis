//go:build integration

package board_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"orbis.local/orbis/internal/board"
)

func TestBoardStreamResumesCommittedChangesAndClosesOnArchive(t *testing.T) {
	f := setup(t)
	server := httptest.NewServer(f.env.Handler)
	defer server.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 8*time.Second)
	defer cancel()
	connect := func(after int64) *websocket.Conn {
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+f.path+"/sync", &websocket.DialOptions{Subprotocols: []string{"orbis.board.v1"}})
		if err != nil {
			t.Fatal(err)
		}
		if err := wsjson.Write(ctx, conn, map[string]any{"type": "authenticate", "protocol_version": 1, "token": f.token, "after_version": after}); err != nil {
			t.Fatal(err)
		}
		return conn
	}
	type frame struct {
		Type   string
		Data   board.ChangePage
		Status int
	}
	conn := connect(1)
	defer conn.CloseNow()
	var ready frame
	if err := wsjson.Read(ctx, conn, &ready); err != nil || ready.Type != "ready" {
		t.Fatalf("ready: %+v %v", ready, err)
	}
	e := node(f.board.Pages[0].ID)
	change := f.change(t, board.Command{Type: "elements.create", Elements: []board.Element{e}})
	var delivered frame
	if err := wsjson.Read(ctx, conn, &delivered); err != nil {
		t.Fatal(err)
	}
	if delivered.Type != "changes" || len(delivered.Data.Items) != 1 || delivered.Data.Items[0].Revision != change.Revision {
		t.Fatal("stream omitted committed mutation")
	}
	conn.CloseNow()
	resumed := connect(1)
	defer resumed.CloseNow()
	if err := wsjson.Read(ctx, resumed, &delivered); err != nil || len(delivered.Data.Items) != 1 {
		t.Fatalf("resume: %v", err)
	}
	if err := wsjson.Read(ctx, resumed, &ready); err != nil || ready.Type != "ready" {
		t.Fatalf("resume ready: %v", err)
	}
	if err := f.env.DB.Exec("UPDATE documents SET is_archived=TRUE WHERE id=?", f.board.DocumentID).Error; err != nil {
		t.Fatal(err)
	}
	var denied frame
	if err := wsjson.Read(ctx, resumed, &denied); err != nil {
		t.Fatal(err)
	}
	if denied.Type != "error" || denied.Status != 404 {
		t.Fatalf("archived stream remains active: %+v", denied)
	}
}
