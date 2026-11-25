//go:build integration

package document_test

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/tests/testenv"
)

func TestCollaborationNegotiatesSnapshotAndResumesAuthorizedBase(t *testing.T) {
	f, engine, blocks, base := collaborationFixture(t)
	route := f.path + "/collaboration"
	negotiated := httptest.NewRequest(http.MethodGet, route, nil)
	negotiated.Header.Set("Authorization", "Bearer "+f.session.AccessToken)
	negotiated.Header.Set("Accept", "application/vnd.orbis.yjs, application/json")
	wire, err := f.env.DoRequest(negotiated)
	if err != nil {
		t.Fatal(err)
	}
	if wire.Status != http.StatusOK || wire.Header.Get("Content-Type") != "application/vnd.orbis.yjs" || len(wire.Body) < 5 {
		t.Fatalf("expected binary snapshot, got %d %s", wire.Status, wire.Header.Get("Content-Type"))
	}
	length := int(binary.BigEndian.Uint32(wire.Body))
	if length > len(wire.Body)-4 {
		t.Fatal("invalid snapshot metadata length")
	}
	var metadata document.CollaborationState
	if err := json.Unmarshal(wire.Body[4:4+length], &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata.DocumentID != base.DocumentID || metadata.Epoch != base.Epoch ||
		metadata.ContentVersion != base.ContentVersion || !bytes.Equal(wire.Body[4+length:], base.State) {
		t.Fatal("binary snapshot differs from legacy JSON")
	}
	resume := fmt.Sprintf("%s?epoch=%s&after_version=%d", route, base.Epoch, base.ContentVersion)
	current := testenv.Decode[document.CollaborationState](t, f.env.Call(t, "POST", resume, f.session.AccessToken, nil, 200))
	if current.ContentVersion != base.ContentVersion || current.Epoch != base.Epoch || len(current.State) != 0 || len(current.Updates) != 0 {
		t.Fatal("an up-to-date base should not receive body bytes")
	}
	blocks[0].Content[0].Text += " updated"
	update := generatedUpdate(t, engine, base, blocks)
	f.env.Call(t, "POST", route+"/updates", f.session.AccessToken, update, 200)
	delta := testenv.Decode[document.CollaborationState](t, f.env.Call(t, "GET", resume, f.session.AccessToken, nil, 200))
	if delta.ContentVersion != base.ContentVersion+1 || delta.Epoch != base.Epoch || len(delta.State) != 0 || len(delta.Updates) != 1 {
		t.Fatal("expected a continuous increment over the confirmed base")
	}
	otherEpoch := fmt.Sprintf("%s?epoch=00000000-0000-4000-8000-000000000001&after_version=%d", route, delta.ContentVersion)
	full := testenv.Decode[document.CollaborationState](t, f.env.Call(t, "GET", otherEpoch, f.session.AccessToken, nil, 200))
	if len(full.State) == 0 || len(full.Updates) != 0 || full.Epoch != base.Epoch {
		t.Fatal("a different epoch must receive a full snapshot")
	}
	if err := f.env.DB.Exec("UPDATE workspace_members SET role='viewer' WHERE workspace_id=? AND user_id=?", f.workspaceID, f.session.User.ID).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "POST", resume, f.session.AccessToken, nil, 403)
	f.env.Call(t, "GET", resume, f.session.AccessToken, nil, 200)
}
