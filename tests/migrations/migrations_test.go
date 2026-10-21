//go:build integration

package migrations_test

import (
	"net/url"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/google/uuid"

	"orbis.local/orbis/migrations"
	"orbis.local/orbis/tests/testenv"
)

func TestFreshInstallAndRepeatMigration(t *testing.T) {
	env := testenv.New(t)
	if err := migrations.Up(env.URL); err != nil {
		t.Fatal(err)
	}
	var state struct {
		Version int
		Dirty   bool
	}
	if err := env.DB.Table("schema_migrations").Take(&state).Error; err != nil {
		t.Fatal(err)
	}
	if state.Version != migrations.Version || state.Dirty {
		t.Fatal("migration state is not clean")
	}
	var columns []struct {
		ColumnName string
		DataType   string
		IsNullable string
	}
	if err := env.DB.Raw(
		"SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'documents' AND column_name LIKE '%at_ms'",
	).Scan(&columns).Error; err != nil {
		t.Fatal(err)
	}
	if len(columns) != 3 {
		t.Fatal("expected document audit and archive timestamps")
	}
	for _, column := range columns {
		if column.DataType != "bigint" {
			t.Fatalf("%s is not BIGINT", column.ColumnName)
		}
		if column.ColumnName == "archived_at_ms" && column.IsNullable != "YES" {
			t.Fatal("archive timestamp must be nullable")
		}
	}
}

func TestUpgradePreservesVersionOneDocuments(t *testing.T) {
	env := testenv.New(t)
	owner, wid := env.Owner(t)
	path, err := filepath.Abs("../../migrations")
	if err != nil {
		t.Fatal(err)
	}
	source := (&url.URL{Scheme: "file", Path: path}).String()
	m, err := migrate.New(source, env.URL)
	if err != nil {
		t.Fatal("open isolated migration fixture")
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
	if err := m.Migrate(1); err != nil {
		t.Fatal(err)
	}
	cid, first, second := uuid.NewString(), uuid.NewString(), uuid.NewString()
	now := time.Now().UnixMilli()
	if err := env.DB.Exec(
		"INSERT INTO collections (id,workspace_id,title,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?)",
		cid,
		wid,
		"Existing collection",
		now,
		now,
	).Error; err != nil {
		t.Fatal(err)
	}
	for index, id := range []string{first, second} {
		if err := env.DB.Exec(
			`INSERT INTO documents
            (id,workspace_id,collection_id,title,content_version,created_at_ms,updated_at_ms)
            VALUES (?,?,?,?,?,?,?)`,
			id,
			wid,
			cid,
			"Existing document",
			1,
			now+int64(index),
			now+int64(index),
		).Error; err != nil {
			t.Fatal(err)
		}
		if err := env.DB.Exec(
			"INSERT INTO document_revisions (document_id,version,title,author_id,created_at_ms) VALUES (?,?,?,?,?)",
			id,
			1,
			"Existing document",
			owner.User.ID,
			now,
		).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := env.DB.Exec("INSERT INTO document_block_versions(document_id,block_id,position,payload,valid_from) VALUES(?,?,0,?::jsonb,1)", first, uuid.NewString(), `{"type":"paragraph","props":{},"content":[{"text":"Existing renderer text","marks":[],"href":null}]}`).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrations.Up(env.URL); err != nil {
		t.Fatal(err)
	}
	var projection string
	if err := env.DB.Table("document_block_versions").Select("plain_text").Where("document_id=?", first).Scan(&projection).Error; err != nil {
		t.Fatal(err)
	}
	if projection != "Existing renderer text" {
		t.Fatalf("search backfill lost existing text: %q", projection)
	}
	var assignments int64
	if err := env.DB.Raw("SELECT count(*) FROM collections c JOIN collection_groups g ON g.id=c.group_id AND g.workspace_id=c.workspace_id WHERE c.id=? AND g.is_default", cid).Scan(&assignments).Error; err != nil {
		t.Fatal(err)
	}
	if assignments != 1 {
		t.Fatal("upgrade did not backfill the default collection group")
	}
	result := testenv.Decode[struct {
		Items []struct {
			ID       string  `json:"id"`
			ParentID *string `json:"parent_id"`
			Position int     `json:"position"`
		} `json:"items"`
	}](t, env.Call(
		t,
		"GET",
		"/api/v1/workspaces/"+wid+"/collections/"+cid+"/children",
		owner.AccessToken,
		nil,
		200,
	))
	if len(result.Items) != 2 {
		t.Fatal("upgrade lost existing documents")
	}
	for index, id := range []string{first, second} {
		if result.Items[index].ID != id || result.Items[index].ParentID != nil || result.Items[index].Position != index {
			t.Fatal("upgrade did not establish deterministic root positions")
		}
		env.Call(
			t,
			"GET",
			"/api/v1/workspaces/"+wid+"/documents/"+id+"/content?version=1",
			owner.AccessToken,
			nil,
			200,
		)
	}
}
