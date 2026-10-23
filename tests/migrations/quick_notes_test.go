//go:build integration

package migrations_test

import (
	"net/url"
	"path/filepath"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	"github.com/google/uuid"
	"orbis.local/orbis/migrations"
	"orbis.local/orbis/tests/testenv"
)

func TestQuickNoteUpgradePreservesWorkspaceFilesAndRefusesLossyRollback(t *testing.T) {
	env := testenv.New(t)
	owner, wid := env.Owner(t)
	path, err := filepath.Abs("../../migrations")
	if err != nil {
		t.Fatal(err)
	}
	m, err := migrate.New((&url.URL{Scheme: "file", Path: path}).String(), env.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Close() })
	if err := m.Migrate(26); err != nil {
		t.Fatal(err)
	}
	id := uuid.NewString()
	now := env.Clock.Now().UnixMilli()
	if err := env.DB.Exec(`INSERT INTO assets(id,owner_id,workspace_id,kind,state,storage_key,filename,created_at_ms,updated_at_ms) VALUES(?,?,?,'file','staging',?,'original.txt',?,?)`, id, owner.User.ID, wid, id, now, now).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrations.Up(env.URL); err != nil {
		t.Fatal(err)
	}
	var kind string
	if err := env.DB.Table("assets").Select("kind").Where("id=?", id).Scan(&kind).Error; err != nil {
		t.Fatal(err)
	}
	if kind != "file" {
		t.Fatal("upgrade changed existing workspace file visibility")
	}
	env.Call(t, "POST", "/api/v1/workspaces/"+wid+"/quick-note-tags", owner.AccessToken, map[string]any{"name": "Preserve me", "expected_version": 0, "operation_id": uuid.NewString()}, 201)
	if err := m.Migrate(26); err == nil {
		t.Fatal("rollback must not discard personal tags")
	}
	var count int64
	if err := env.DB.Table("quick_note_tags").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("failed rollback changed personal data")
	}
}
