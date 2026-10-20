//go:build integration

package integration_test

import (
	"testing"

	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/sharing"
	"orbis.local/orbis/tests/testenv"
)

func TestAgentShareManagementRequiresCollectionScope(t *testing.T) {
	f := newAgent(t, integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.SharesManage}})
	created := testenv.Decode[struct {
		Share struct {
			ID      string
			Version int64
		}
		Path   string
		Future bool `json:"includes_future_descendants"`
	}](t, f.env.Call(t, "POST", f.agent+"/shares", f.credential.Token, sharing.CreateInput{CollectionID: f.cid, RootDocumentID: &f.did, AcknowledgePublicScope: true}, 201))
	if created.Path == "" || !created.Future {
		t.Fatal("live-scope acknowledgement result missing")
	}
	listed := testenv.Decode[struct {
		Items []struct {
			ID   string
			Path *string
		}
	}](t, f.env.Call(t, "GET", f.agent+"/shares?collection_id="+f.cid, f.credential.Token, nil, 200))
	if len(listed.Items) != 1 || listed.Items[0].Path == nil || *listed.Items[0].Path != created.Path {
		t.Fatal("share discovery lost recoverable URL")
	}
	f.env.Call(t, "POST", f.agent+"/shares/"+created.Share.ID+"/revoke", f.credential.Token, map[string]any{"expected_version": created.Share.Version}, 200)
	exactCredential := testenv.Decode[credential](t, f.env.Call(t, "POST", f.base+"/integration-tokens", f.owner.AccessToken, integration.TokenInput{Name: "Exact reader", DocumentID: &f.did, Permissions: []integration.Permission{integration.DocumentsRead, integration.SharesManage}}, 201))
	f.env.Call(t, "POST", f.agent+"/shares", exactCredential.Token, sharing.CreateInput{CollectionID: f.cid, RootDocumentID: &f.did, AcknowledgePublicScope: true}, 403)
	f.env.Call(t, "GET", f.agent+"/shares", exactCredential.Token, nil, 403)
}
