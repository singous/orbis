//go:build integration

package integration_test

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/tests/testenv"
)

type credential struct {
	Credential integration.Token
	Token      string
}
type fixture struct {
	env                                               *testenv.Environment
	owner                                             testenv.Session
	wid, cid, did, other, child, blockID, base, agent string
	credential                                        credential
}

func newAgent(t *testing.T, input integration.TokenInput) fixture {
	t.Helper()
	return newAgentIn(t, testenv.New(t), input)
}
func newAgentIn(t *testing.T, env *testenv.Environment, input integration.TokenInput) fixture {
	t.Helper()
	owner, wid := env.Owner(t)
	base := "/api/v1/workspaces/" + wid
	c := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/collections", owner.AccessToken, map[string]any{"title": "Agent collection"}, 201))
	makeDoc := func(title string, parent *string) string {
		return testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/collections/"+c.ID+"/documents", owner.AccessToken, map[string]any{"title": title, "parent_id": parent}, 201)).ID
	}
	did := makeDoc("Agent document", nil)
	other := makeDoc("Other document", nil)
	child := makeDoc("Descendant", &did)
	blockID := uuid.NewString()
	env.Call(t, "PUT", base+"/documents/"+did+"/content", owner.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "title": "Agent document", "blocks": []document.Block{{ID: blockID, Type: "paragraph", Content: []document.TextRun{{Text: "Draft text", Marks: []string{"bold"}}}}}}, 200)
	if input.Name == "" {
		input.Name = "Agent key"
	}
	if input.CollectionID == nil && input.DocumentID == nil {
		input.CollectionID = &c.ID
	}
	if input.DocumentID != nil && *input.DocumentID == "exact" {
		input.DocumentID = &did
	}
	value := testenv.Decode[credential](t, env.Call(t, "POST", base+"/integration-tokens", owner.AccessToken, input, 201))
	return fixture{env: env, owner: owner, wid: wid, cid: c.ID, did: did, other: other, child: child, blockID: blockID, base: base, agent: "/api/v1/agent/workspaces/" + wid, credential: value}
}
func TestIntegrationTokenExactScopeAndCredentialLifecycle(t *testing.T) {
	exact := "exact"
	f := newAgent(t, integration.TokenInput{DocumentID: &exact, Permissions: []integration.Permission{integration.DocumentsRead}})
	f.env.Call(t, "GET", f.agent+"/me", f.credential.Token, nil, 200)
	capabilities := f.env.Call(t, "GET", f.agent+"/capabilities", f.credential.Token, nil, 200)
	if !strings.Contains(string(capabilities.Data), "2.0") {
		t.Fatal("protocol discovery missing")
	}
	docs := testenv.Decode[struct{ Items []struct{ ID string } }](t, f.env.Call(t, "GET", f.agent+"/documents", f.credential.Token, nil, 200))
	if len(docs.Items) != 1 || docs.Items[0].ID != f.did {
		t.Fatal("exact document token included descendants")
	}
	f.env.Call(t, "GET", f.agent+"/documents/"+f.did+"/content", f.credential.Token, nil, 200)
	for _, id := range []string{f.child, f.other} {
		f.env.Call(t, "GET", f.agent+"/documents/"+id, f.credential.Token, nil, 404)
	}
	f.env.Call(t, "GET", f.base+"/collections", f.credential.Token, nil, 401)
	f.env.Call(t, "GET", f.agent+"/me", f.owner.AccessToken, nil, 401)
	records := f.env.Call(t, "GET", f.base+"/integration-tokens", f.owner.AccessToken, nil, 200)
	if strings.Contains(string(records.Data), f.credential.Token) || strings.Contains(string(records.Data), "secret_hash") {
		t.Fatal("credential management leaked a reusable secret")
	}
	f.env.Call(t, "POST", f.base+"/integration-tokens/"+f.credential.Credential.ID+"/revoke", f.owner.AccessToken, map[string]any{"expected_version": 1}, 200)
	f.env.Call(t, "GET", f.agent+"/me", f.credential.Token, nil, 401)
}
func TestAgentCommandsPreviewReplayAndCurrentRole(t *testing.T) {
	f := newAgent(t, integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}})
	input := document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 2, Operations: []document.Operation{{Type: "replace_text", BlockID: f.blockID, Match: "Draft", Replacement: "Reviewed"}}}
	path := f.agent + "/documents/" + f.did
	f.env.Call(t, "POST", path+"/operations/preview", f.credential.Token, input, 200)
	first := testenv.Decode[document.CommandResult](t, f.env.Call(t, "POST", path+"/operations", f.credential.Token, input, 200))
	if first.ContentVersion != 3 {
		t.Fatal("command version was not committed")
	}
	f.env.Call(t, "POST", path+"/operations", f.credential.Token, input, 200)
	receipt := testenv.Decode[integration.OperationRecord](t, f.env.Call(t, "GET", f.agent+"/operations/"+input.OperationID, f.credential.Token, nil, 200))
	if receipt.State != "completed" || receipt.DocumentID == nil || *receipt.DocumentID != f.did {
		t.Fatal("token receipt was not atomic")
	}
	content := f.env.Call(t, "GET", path+"/content", f.credential.Token, nil, 200)
	if !strings.Contains(string(content.Data), "Reviewed") || !strings.Contains(string(content.Data), "bold") {
		t.Fatal("text replacement lost formatting")
	}
	input.Operations[0].Replacement = "different"
	f.env.Call(t, "POST", path+"/operations", f.credential.Token, input, 409)
}
func TestAgentConcurrentCommandsHaveNoForeignKeyDeadlock(t *testing.T) {
	f := newAgent(t, integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}})
	inputs := []document.CommandsInput{{OperationID: uuid.NewString(), ExpectedVersion: 2, Operations: []document.Operation{{Type: "replace_text", BlockID: f.blockID, Match: "Draft", Replacement: "First"}}}, {OperationID: uuid.NewString(), ExpectedVersion: 2, Operations: []document.Operation{{Type: "replace_text", BlockID: f.blockID, Match: "Draft", Replacement: "Second"}}}}
	results := make([]testenv.Result, 2)
	errs := make([]error, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range inputs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results[i], errs[i] = f.env.Do("POST", f.agent+"/documents/"+f.did+"/operations", f.credential.Token, inputs[i])
		}()
	}
	close(start)
	wg.Wait()
	wins, conflicts := 0, 0
	for i, result := range results {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		switch result.Status {
		case 200:
			wins++
		case 409:
			conflicts++
		default:
			t.Fatalf("unexpected concurrent result: %+v", result)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatal("agent commands did not preserve version CAS")
	}
}
func TestIntegrationExpiryAndInvalidLifetime(t *testing.T) {
	f := newAgent(t, integration.TokenInput{ExpiresInDays: 1})
	f.env.Clock.Advance(24 * time.Hour)
	f.env.Call(t, "GET", f.agent+"/me", f.credential.Token, nil, 401)
	// Fresh JWT credentials are independent from the expired integration credential.
	session := f.env.Login(t, "owner@example.test")
	f.env.Call(t, "POST", f.base+"/integration-tokens", session.AccessToken, map[string]any{"name": "Invalid TTL", "expires_in_days": 0}, 422)
}

func TestAgentCreatesAtomicallyAndExportsPinnedNativeContent(t *testing.T) {
	f := newAgent(t, integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}})
	input := integration.CreateDocumentInput{OperationID: uuid.NewString(), CollectionID: f.cid, Title: "Constructed", Markdown: "# Heading\n\n**Formatted** body"}
	first := testenv.Decode[integration.CreatedDocument](t, f.env.Call(t, "POST", f.agent+"/documents", f.credential.Token, input, 201))
	second := testenv.Decode[integration.CreatedDocument](t, f.env.Call(t, "POST", f.agent+"/documents", f.credential.Token, input, 201))
	if first.DocumentID != second.DocumentID || first.ContentVersion != 1 {
		t.Fatal("constructor retry created another document")
	}
	exported := f.env.Call(t, "GET", f.agent+"/documents/"+first.DocumentID+"/export?version=1&format=json", f.credential.Token, nil, 200)
	if !strings.Contains(string(exported.Data), "Formatted") || !strings.Contains(string(exported.Data), "preserves_block_ids") {
		t.Fatal("native export omitted content")
	}
	markdown := f.env.Call(t, "GET", f.agent+"/documents/"+first.DocumentID+"/export?version=1&format=markdown", f.credential.Token, nil, 200)
	if !strings.Contains(string(markdown.Data), "**Formatted**") {
		t.Fatal("Markdown export lost text formatting")
	}
	f.env.Call(t, "GET", f.agent+"/documents/"+first.DocumentID+"/export", f.credential.Token, nil, 422)
	input.Markdown = "changed intent"
	f.env.Call(t, "POST", f.agent+"/documents", f.credential.Token, input, 409)
}
func TestAgentCannotReferenceUngrantablePrivateFiles(t *testing.T) {
	f := newAgent(t, integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite, integration.SharesManage}})
	assetID := uuid.NewString()
	reference := document.AssetLink(assetID)
	input := document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 2, Operations: []document.Operation{{Type: "insert_blocks", Blocks: []document.Block{{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "Private", Href: &reference}}}}}}}
	for _, suffix := range []string{"/operations/preview", "/operations"} {
		f.env.Call(t, "POST", f.agent+"/documents/"+f.did+suffix, f.credential.Token, input, 403)
	}
	f.env.Call(t, "POST", f.agent+"/documents", f.credential.Token, integration.CreateDocumentInput{OperationID: uuid.NewString(), CollectionID: f.cid, Title: "Denied private link", Markdown: "[Private](" + reference + ")"}, 403)
}
