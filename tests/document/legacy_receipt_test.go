//go:build integration

package document_test

import (
	"github.com/google/uuid"
	"testing"

	"orbis.local/orbis/internal/document"
)

func TestUnknownLegacyReceiptActorNeverReplaysAsCurrentUser(t *testing.T) {
	f := newDocument(t)
	input := document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 1, Operations: []document.Operation{{Type: "update_metadata", Title: "Reserved intent"}}}
	prepared, err := document.PrepareCommand(document.DirectoryScope{ActorID: f.session.User.ID, WorkspaceID: f.workspaceID, DocumentID: f.documentID}, input, "", f.env.Clock.Now().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	if err := f.env.DB.Exec("INSERT INTO document_operations(document_id,operation_id,actor_id,request_hash,result_version,created_at_ms) VALUES (?,?,NULL,?,1,?)", f.documentID, input.OperationID, prepared.RequestHash, f.env.Clock.Now().UnixMilli()).Error; err != nil {
		t.Fatal(err)
	}
	result := f.env.Call(t, "POST", f.path+"/operations", f.session.AccessToken, input, 409)
	if result.Code != "IDEMPOTENCY_CONFLICT" {
		t.Fatal("unknown original actor did not reserve the operation identity")
	}
	f.env.Call(t, "GET", f.path+"/operations/"+input.OperationID, f.session.AccessToken, nil, 404)
	var version int64
	if err := f.env.DB.Table("documents").Select("content_version").Where("id=?", f.documentID).Scan(&version).Error; err != nil || version != 1 {
		t.Fatal("unknown original actor authorized a new mutation")
	}
}
