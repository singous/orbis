//go:build integration

package workspace_test

import (
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/internal/sharing"
	"orbis.local/orbis/tests/testenv"
)

func TestInactiveWorkspaceHidesPrivateAndPublicResources(t *testing.T) {
	env := testenv.New(t)
	session, wid := env.Owner(t)
	base := "/api/v1/workspaces/" + wid
	collection := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/collections", session.AccessToken, map[string]any{"title": "State"}, 201))
	doc := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/collections/"+collection.ID+"/documents", session.AccessToken, map[string]any{"title": "State document"}, 201))
	share := testenv.Decode[struct{ Token string }](t, env.Call(t, "POST", base+"/shares", session.AccessToken, sharing.CreateInput{CollectionID: collection.ID, AcknowledgePublicScope: true}, 201))
	site := testenv.Decode[struct {
		ID      string
		Version int64
	}](t, env.Call(t, "POST", base+"/sites", session.AccessToken, publishing.Config{Name: "State site", Slug: "state-site", Navigation: []publishing.Navigation{{DocumentID: doc.ID, Slug: "page", Title: "Page"}}}, 201))
	preview := testenv.Decode[publishing.Preview](t, env.Call(t, "GET", base+"/sites/"+site.ID+"/preview", session.AccessToken, nil, 200))
	env.Call(t, "POST", base+"/sites/"+site.ID+"/publish", session.AccessToken, publishing.PublishInput{OperationID: uuid.NewString(), ExpectedVersion: site.Version, ExpectedSourceFingerprint: preview.SourceFingerprint}, 201)
	if err := env.DB.Exec("UPDATE workspaces SET is_active=FALSE WHERE id=?", wid).Error; err != nil {
		t.Fatal(err)
	}
	env.Call(t, "GET", "/api/v1/me", session.AccessToken, nil, 200)
	env.Call(t, "GET", base+"/documents/"+doc.ID, session.AccessToken, nil, 404)
	env.Call(t, "GET", "/api/v1/public/shares/"+share.Token+"/directory", "", nil, 404)
	env.Call(t, "GET", "/api/v1/public/sites/state-site/manifest", "", nil, 404)
	env.Call(t, "PUT", "/api/v1/me/workspace-preference", session.AccessToken, map[string]any{"workspace_id": wid}, 404)
	list := testenv.Decode[struct{ Items []any }](t, env.Call(t, "GET", "/api/v1/workspaces", session.AccessToken, nil, 200))
	if len(list.Items) != 0 {
		t.Fatal("inactive workspace remained discoverable")
	}
}
