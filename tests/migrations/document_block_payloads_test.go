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

func TestDocumentBlockPayloadRollbackMaterializesStructureRows(t *testing.T) {
	env := testenv.New(t)
	owner, workspace := env.Owner(t)
	root := "/api/v1/workspaces/" + workspace
	collection := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", root+"/collections", owner.AccessToken, map[string]string{"title": "Payload history"}, 201))
	doc := testenv.Decode[struct{ ID string }](t, env.Call(t, "POST", root+"/collections/"+collection.ID+"/documents", owner.AccessToken, map[string]string{"title": "Payload history"}, 201))
	path := root + "/documents/" + doc.ID
	first := document.Block{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "Retained payload"}}}
	second := document.Block{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "New payload"}}}
	pos := 0
	for index, block := range []document.Block{first, second} {
		env.Call(t, "POST", path+"/operations", owner.AccessToken, document.CommandsInput{
			OperationID: uuid.NewString(), ExpectedVersion: int64(index + 1),
			Operations: []document.Operation{{Type: "insert_blocks", Position: &pos, Blocks: []document.Block{block}}},
		}, 200)
	}
	var references int64
	if err := env.DB.Table("document_block_versions").Where("document_id=? AND payload_revision IS NOT NULL", doc.ID).Count(&references).Error; err != nil {
		t.Fatal(err)
	}
	if references != 1 {
		t.Fatalf("expected one structure reference before rollback, got %d", references)
	}
	migrationPath, err := filepath.Abs("../../migrations")
	if err != nil {
		t.Fatal(err)
	}
	source := (&url.URL{Scheme: "file", Path: migrationPath}).String()
	runner, err := migrate.New(source, env.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if sourceErr, dbErr := runner.Close(); sourceErr != nil || dbErr != nil {
			t.Errorf("close isolated migrator: source=%v database=%v", sourceErr, dbErr)
		}
	})
	if err := runner.Migrate(28); err != nil {
		t.Fatal(err)
	}
	type entry struct {
		BlockID   string
		PlainText string
	}
	var reopened []entry
	if err := env.DB.Table("document_block_versions").Select("block_id, plain_text").
		Where("document_id=? AND valid_to IS NULL AND payload IS NOT NULL", doc.ID).
		Order("position").Scan(&reopened).Error; err != nil {
		t.Fatal(err)
	}
	if len(reopened) != 2 || reopened[0] != (entry{second.ID, "New payload"}) || reopened[1] != (entry{first.ID, "Retained payload"}) {
		t.Fatalf("rollback lost current document content or order: %+v", reopened)
	}
	if err := migrations.Up(env.URL); err != nil {
		t.Fatal(err)
	}
	env.Call(t, "GET", path+"/content?version=2", owner.AccessToken, nil, 200)
}
