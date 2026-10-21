//go:build integration

package migrations_test

import (
	"bytes"
	"net/url"
	"path/filepath"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/migrations"
	"orbis.local/orbis/tests/testenv"
)

func TestCollaborationUpgradePreservesNativeHistoryAndReceiptsBeforeExplicitEnable(t *testing.T) {
	env := testenv.NewWithCollaboration(t)
	session, wid := env.Owner(t)
	base := "/api/v1/workspaces/" + wid
	collection := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/collections", session.AccessToken, map[string]any{"title": "Upgrade fixture"}, 201))
	doc := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/collections/"+collection.ID+"/documents", session.AccessToken, map[string]any{"title": "Existing"}, 201))
	path := base + "/documents/" + doc.ID
	sourcePath, err := filepath.Abs("../../migrations")
	if err != nil {
		t.Fatal(err)
	}
	m, err := migrate.New((&url.URL{Scheme: "file", Path: sourcePath}).String(), env.URL)
	if err != nil {
		t.Fatal("open isolated migration fixture")
	}
	t.Cleanup(func() {
		a, b := m.Close()
		if a != nil || b != nil {
			t.Errorf("close migration fixture: %v %v", a, b)
		}
	})
	body := map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "title": "Existing native source", "blocks": []document.Block{{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "Original native history", Marks: []string{"bold"}}}}}}
	env.Call(t, "PUT", path+"/content", session.AccessToken, body, 200)
	before := env.Call(t, "GET", path+"/content?version=2", session.AccessToken, nil, 200)
	// The previous Go schema has the same native history and operation receipts.
	// Only this test's disposable database is returned to that schema.
	if err := m.Migrate(21); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Up(env.URL); err != nil {
		t.Fatal(err)
	}
	var seeded int64
	if err := env.DB.Table("document_collaboration_states").Count(&seeded).Error; err != nil || seeded != 0 {
		t.Fatalf("SQL upgrade unexpectedly converted user documents: %d %v", seeded, err)
	}
	env.RestartApplication(t)
	after := env.Call(t, "GET", path+"/content?version=2", session.AccessToken, nil, 200)
	if !bytes.Equal(before.Data, after.Data) {
		t.Fatal("upgrade changed the existing native content or history")
	}
	env.Call(t, "GET", path+"/content?version=1", session.AccessToken, nil, 200)
	replay := testenv.Decode[struct{ Revision struct{ Version int64 } }](t, env.Call(t, "PUT", path+"/content", session.AccessToken, body, 200))
	if replay.Revision.Version != 2 {
		t.Fatal("upgrade did not preserve the original operation receipt")
	}
	state := testenv.Decode[document.CollaborationState](t, env.Call(t, "POST", path+"/collaboration", session.AccessToken, nil, 200))
	if state.ContentVersion != 2 {
		t.Fatal("explicit collaboration enable created another native revision")
	}
	enabled := env.Call(t, "GET", path+"/content?version=2", session.AccessToken, nil, 200)
	if !bytes.Equal(before.Data, enabled.Data) {
		t.Fatal("explicit collaboration enable changed the existing native snapshot")
	}
}
