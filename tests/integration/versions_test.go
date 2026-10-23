//go:build integration

package integration_test

import (
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/tests/testenv"
)

func TestAgentVersionsShareWebBoundariesAndEnforceExactScope(t *testing.T) {
	exact := "exact"
	f := newAgent(t, integration.TokenInput{DocumentID: &exact, Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}})
	path := f.agent + "/documents/" + f.did + "/versions"
	input := document.CreateVersion{OperationID: uuid.NewString(), SourceRevision: 2, Name: "Agent review"}
	version := testenv.Decode[document.Version](t, f.env.Call(t, "POST", path, f.credential.Token, input, 201))
	repeated := testenv.Decode[document.Version](t, f.env.Call(t, "POST", path, f.credential.Token, input, 201))
	if repeated.ID != version.ID {
		t.Fatal("agent retry created another version")
	}
	f.env.Call(t, "GET", f.base+"/documents/"+f.did+"/versions/"+version.ID+"/content", f.owner.AccessToken, nil, 200)
	list := testenv.Decode[document.VersionPage](t, f.env.Call(t, "GET", path, f.credential.Token, nil, 200))
	if len(list.Items) != 1 || list.Items[0].ID != version.ID {
		t.Fatal("agent and web did not share the same version store")
	}
	f.env.Call(t, "GET", f.agent+"/documents/"+f.other+"/versions", f.credential.Token, nil, 404)
	f.env.Call(t, "GET", f.agent+"/documents/"+f.child+"/versions/"+version.ID+"/content", f.credential.Token, nil, 404)
	bad := input
	bad.OperationID = "not-a-uuid"
	f.env.Call(t, "POST", path, f.credential.Token, bad, 422)
	changed := document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 2, Operations: []document.Operation{{Type: "replace_text", BlockID: f.blockID, Match: "Draft", Replacement: "Later"}}}
	f.env.Call(t, "POST", f.agent+"/documents/"+f.did+"/operations", f.credential.Token, changed, 200)
	operation := uuid.NewString()
	restore := map[string]any{"operation_id": operation, "expected_revision": 3}
	first := f.env.Call(t, "POST", path+"/"+version.ID+"/restore", f.credential.Token, restore, 200)
	second := f.env.Call(t, "POST", path+"/"+version.ID+"/restore", f.credential.Token, restore, 200)
	if string(first.Data) != string(second.Data) {
		t.Fatal("agent restore retry did not return the committed result")
	}
	receipt := testenv.Decode[integration.OperationRecord](t, f.env.Call(t, "GET", f.agent+"/operations/"+operation, f.credential.Token, nil, 200))
	if receipt.Kind != "version-restore" || receipt.State != "completed" {
		t.Fatal("agent version receipt was not committed atomically")
	}
	f.env.Call(t, "POST", f.base+"/integration-tokens/"+f.credential.Credential.ID+"/revoke", f.owner.AccessToken, map[string]any{"expected_version": 1}, 200)
	f.env.Call(t, "GET", path, f.credential.Token, nil, 401)
}

func TestAgentVersionWritesRequireWriteGrant(t *testing.T) {
	f := newAgent(t, integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead}})
	path := f.agent + "/documents/" + f.did + "/versions"
	f.env.Call(t, "GET", path, f.credential.Token, nil, 200)
	f.env.Call(t, "POST", path, f.credential.Token, document.CreateVersion{OperationID: uuid.NewString(), SourceRevision: 2, Name: "Denied"}, 403)
}
