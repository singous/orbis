//go:build integration

package migrations_test

import (
	"net/url"
	"path/filepath"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/migrations"
	"orbis.local/orbis/tests/testenv"
)

func TestDocumentVersionUpgradePreservesHistoryAndBlocksLossyDowngrade(t *testing.T) {
	env := testenv.New(t)
	path, err := filepath.Abs("../../migrations")
	if err != nil {
		t.Fatal(err)
	}
	m, err := migrate.New((&url.URL{Scheme: "file", Path: path}).String(), env.URL)
	if err != nil {
		t.Fatal("open isolated migration driver")
	}
	t.Cleanup(func() {
		sourceErr, databaseErr := m.Close()
		if sourceErr != nil {
			t.Error(sourceErr)
		}
		if databaseErr != nil {
			t.Error(databaseErr)
		}
	})
	if err := m.Migrate(24); err != nil {
		t.Fatal(err)
	}
	owner, wid := env.Owner(t)
	base := "/api/v1/workspaces/" + wid
	collection := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/collections", owner.AccessToken, map[string]any{"title": "Existing collection"}, 201))
	doc := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/collections/"+collection.ID+"/documents", owner.AccessToken, map[string]any{"title": "Existing document"}, 201))
	if err := migrations.Up(env.URL); err != nil {
		t.Fatal(err)
	}
	var pending int64
	if err := env.DB.Table("document_version_activity").Where("document_id=? AND source_revision=1", doc.ID).Count(&pending).Error; err != nil {
		t.Fatal(err)
	}
	if pending != 1 {
		t.Fatal("upgrade did not schedule the existing content baseline")
	}
	version := testenv.Decode[document.Version](t, env.Call(t, "POST", base+"/documents/"+doc.ID+"/versions", owner.AccessToken, map[string]any{"operation_id": uuid.NewString(), "source_revision": 1, "name": "Retained milestone"}, 201))
	if err := m.Migrate(24); err == nil {
		t.Fatal("downgrade silently discarded version history")
	}
	var retained int64
	if err := env.DB.Table("document_versions").Where("id=?", version.ID).Count(&retained).Error; err != nil {
		t.Fatal(err)
	}
	if retained != 1 {
		t.Fatal("failed downgrade removed saved version data")
	}
	env.Call(t, "GET", base+"/documents/"+doc.ID+"/versions/"+version.ID+"/content", owner.AccessToken, nil, 200)
}
