//go:build integration

package board_test

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/board"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/tests/testenv"
)

func TestAgentBoardScopeReplayAndRevocation(t *testing.T) {
	f := setup(t)
	base := "/api/v1/workspaces/" + f.board.WorkspaceID
	agent := "/api/v1/agent/workspaces/" + f.board.WorkspaceID
	type credential struct {
		Credential integration.Token
		Token      string
	}
	token := testenv.Decode[credential](t, f.env.Call(t, "POST", base+"/integration-tokens", f.token, integration.TokenInput{Name: "Scoped board agent", DocumentID: &f.board.DocumentID, Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}}, 201))
	path := agent + "/boards/" + f.board.ID
	f.env.Call(t, "GET", agent+"/board-catalog", token.Token, nil, 200)
	f.env.Call(t, "GET", agent+"/board-templates", token.Token, nil, 200)
	list := testenv.Decode[struct{ Items []board.Summary }](t, f.env.Call(t, "GET", agent+"/boards", token.Token, nil, 200))
	if len(list.Items) != 1 || list.Items[0].ID != f.board.ID {
		t.Fatal("exact document token leaked or lost boards")
	}
	a := node(f.board.Pages[0].ID)
	mutation := board.Mutation{OperationID: uuid.NewString(), SchemaVersion: 1, Commands: []board.Command{{Type: "elements.create", Elements: []board.Element{a}}}}
	first := testenv.Decode[board.Change](t, f.env.Call(t, "POST", path+"/commands", token.Token, mutation, 200))
	replay := testenv.Decode[board.Change](t, f.env.Call(t, "POST", path+"/commands", token.Token, mutation, 200))
	if first.Revision != replay.Revision {
		t.Fatal("agent replay advanced revision")
	}
	receipt := testenv.Decode[integration.OperationRecord](t, f.env.Call(t, "GET", agent+"/operations/"+mutation.OperationID, token.Token, nil, 200))
	var result board.Change
	if receipt.State != "completed" || json.Unmarshal(receipt.Result, &result) != nil || result.Revision != first.Revision {
		t.Fatal("global operation receipt differs")
	}
	mutation.Commands[0].Elements[0].Text = "Changed intent"
	f.env.Call(t, "POST", path+"/commands", token.Token, mutation, 409)
	mutation.OperationID = "not-a-uuid"
	f.env.Call(t, "POST", path+"/commands", token.Token, mutation, 422)
	other := board.Create{ID: uuid.NewString(), OperationID: uuid.NewString(), CollectionID: f.board.CollectionID, Title: "Other", PageID: uuid.NewString(), Elements: []board.Element{}}
	f.env.Call(t, "POST", agent+"/boards", token.Token, other, 404)
	created := testenv.Decode[board.Board](t, f.env.Call(t, "POST", base+"/boards", f.token, other, 201))
	f.env.Call(t, "GET", agent+"/boards/"+created.ID, token.Token, nil, 404)
	f.env.Call(t, "GET", agent+"/boards/"+created.ID+"/snapshot", token.Token, nil, 404)
	f.env.Call(t, "POST", base+"/integration-tokens/"+token.Credential.ID+"/revoke", f.token, map[string]any{"expected_version": 1}, 200)
	f.env.Call(t, "GET", path, token.Token, nil, 401)
	mutation.OperationID = uuid.NewString()
	f.env.Call(t, "POST", path+"/commands", token.Token, mutation, 401)
}

func TestAgentBoardCreationUsesSingleReceipt(t *testing.T) {
	f := setup(t)
	base := "/api/v1/workspaces/" + f.board.WorkspaceID
	agent := "/api/v1/agent/workspaces/" + f.board.WorkspaceID
	token := testenv.Decode[struct{ Token string }](t, f.env.Call(t, "POST", base+"/integration-tokens", f.token, integration.TokenInput{Name: "Board author", CollectionID: &f.board.CollectionID, Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}}, 201))
	input := board.Create{ID: uuid.NewString(), OperationID: uuid.NewString(), CollectionID: f.board.CollectionID, Title: "Agent board", PageID: uuid.NewString(), Elements: []board.Element{}}
	first := testenv.Decode[board.Board](t, f.env.Call(t, "POST", agent+"/boards", token.Token, input, 201))
	replay := testenv.Decode[board.Board](t, f.env.Call(t, "POST", agent+"/boards", token.Token, input, 201))
	if first.DocumentID != replay.DocumentID {
		t.Fatal("agent duplicated owner document")
	}
	input.OperationID = "invalid"
	f.env.Call(t, "POST", agent+"/boards", token.Token, input, 422)
}
