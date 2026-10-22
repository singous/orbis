//go:build integration

package migrations_test

import (
	"encoding/json"
	"net/url"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/google/uuid"
	"orbis.local/orbis/internal/sheet"
	"orbis.local/orbis/migrations"
	"orbis.local/orbis/tests/testenv"
)

func TestSheetDocumentUpgradePreservesExistingTableRecords(t *testing.T) {
	env := testenv.New(t)
	owner, wid := env.Owner(t)
	base := "/api/v1/workspaces/" + wid
	collection := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/collections", owner.AccessToken, map[string]any{"title": "Existing tables"}, 201))
	original := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", base+"/collections/"+collection.ID+"/documents", owner.AccessToken, map[string]any{"title": "Existing prose"}, 201))
	path, err := filepath.Abs("../../migrations")
	if err != nil {
		t.Fatal(err)
	}
	m, err := migrate.New((&url.URL{Scheme: "file", Path: path}).String(), env.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { m.Close() })
	if err := m.Migrate(23); err != nil {
		t.Fatal(err)
	}
	id, record := uuid.NewString(), uuid.NewString()
	now := time.Now().UnixMilli()
	def := sheet.DefaultDefinition("")
	raw, _ := json.Marshal(def)
	if err := env.DB.Exec(`INSERT INTO sheets(id,workspace_id,collection_id,title,creation_hash,definition,schema_version,version,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,1,1,?,?)`, id, wid, collection.ID, "Existing table", "original-request", string(raw), now, now).Error; err != nil {
		t.Fatal(err)
	}
	if err := env.DB.Exec(`INSERT INTO sheet_activity(sheet_id,record_count,revision,updated_at_ms) VALUES(?,1,1,?)`, id, now).Error; err != nil {
		t.Fatal(err)
	}
	values, _ := json.Marshal(map[string]any{def.Fields[0].ID: "Keep this record"})
	if err := env.DB.Exec(`INSERT INTO sheet_records(sheet_id,id,version,values,created_at_ms,updated_at_ms) VALUES(?,?,7,?,?,?)`, id, record, string(values), now, now).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrations.Up(env.URL); err != nil {
		t.Fatal(err)
	}
	table := testenv.Decode[sheet.Sheet](t, env.Call(t, "GET", base+"/sheets/"+id, owner.AccessToken, nil, 200))
	if table.DocumentID == "" || table.ID != id || table.Title != "Existing table" {
		t.Fatal("upgrade lost table identity or title")
	}
	page := testenv.Decode[sheet.Page](t, env.Call(t, "GET", base+"/sheets/"+id+"/records", owner.AccessToken, nil, 200))
	if len(page.Items) != 1 || page.Items[0].ID != record || page.Items[0].Version != 7 || page.Items[0].Values[def.Fields[0].ID] != "Keep this record" {
		t.Fatal("upgrade changed existing records")
	}
	doc := testenv.Decode[struct {
		SheetID string `json:"sheet_id"`
	}](t, env.Call(t, "GET", base+"/documents/"+table.DocumentID, owner.AccessToken, nil, 200))
	if doc.SheetID != id {
		t.Fatal("upgraded table is not a document page")
	}
	env.Call(t, "GET", base+"/documents/"+original.ID, owner.AccessToken, nil, 200)
}
