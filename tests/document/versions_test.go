//go:build integration

package document_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/tests/testenv"
)

func saveVersion(t *testing.T, f fixture, revision int64, name string) document.Version {
	t.Helper()
	return testenv.Decode[document.Version](t, f.env.Call(t, "POST", f.path+"/versions", f.session.AccessToken, map[string]any{"operation_id": uuid.NewString(), "source_revision": revision, "name": name, "description": "Review milestone"}, 201))
}

func versionList(t *testing.T, f fixture) document.VersionPage {
	t.Helper()
	return testenv.Decode[document.VersionPage](t, f.env.Call(t, "GET", f.path+"/versions", f.session.AccessToken, nil, 200))
}

func TestNamedVersionFixesContentWithoutCreatingAContentRevision(t *testing.T) {
	f := newDocument(t)
	body := []document.Block{block("Reviewed body")}
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Review", body), 200)
	input := map[string]any{"operation_id": uuid.NewString(), "source_revision": 2, "name": "评审稿", "description": "Approved"}
	version := testenv.Decode[document.Version](t, f.env.Call(t, "POST", f.path+"/versions", f.session.AccessToken, input, 201))
	if version.ID == "" || version.SourceRevision != 2 || version.Kind != "named" || version.Name == nil || *version.Name != "评审稿" || len(version.ContentHash) != 64 {
		t.Fatalf("invalid named version: %+v", version)
	}
	current := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200))
	if current.Revision.Version != 2 {
		t.Fatal("naming a version changed the content revision")
	}
	body[0].Content[0].Text = "Later body"
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(2, uuid.NewString(), "Later", body), 200)
	fixed := testenv.Decode[struct {
		Version document.Version
		Content content
	}](t, f.env.Call(t, "GET", f.path+"/versions/"+version.ID+"/content", f.session.AccessToken, nil, 200))
	if fixed.Content.Blocks[0].Content[0].Text != "Reviewed body" || fixed.Version.ContentHash != version.ContentHash {
		t.Fatal("later edits changed the saved version")
	}
	edit := map[string]any{"operation_id": uuid.NewString(), "expected_metadata_version": 1, "name": "评审通过", "description": "Updated label"}
	renamed := testenv.Decode[document.Version](t, f.env.Call(t, "PUT", f.path+"/versions/"+version.ID, f.session.AccessToken, edit, 200))
	if renamed.SourceRevision != 2 || renamed.ContentHash != version.ContentHash || renamed.MetadataVersion != 2 || renamed.CreatedAtMS != version.CreatedAtMS {
		t.Fatal("metadata update changed the content boundary")
	}
	replayed := testenv.Decode[document.Version](t, f.env.Call(t, "POST", f.path+"/versions", f.session.AccessToken, input, 201))
	if replayed.ID != version.ID || *replayed.Name != "评审稿" || replayed.MetadataVersion != 1 {
		t.Fatal("creation retry did not return its original receipt")
	}
	input["name"] = "Different intent"
	if got := f.env.Call(t, "POST", f.path+"/versions", f.session.AccessToken, input, 409); got.Code != "IDEMPOTENCY_CONFLICT" {
		t.Fatal("operation ID accepted another intent")
	}
	edit["operation_id"] = uuid.NewString()
	if got := f.env.Call(t, "PUT", f.path+"/versions/"+version.ID, f.session.AccessToken, edit, 409); got.Code != "DOCUMENT_VERSION_METADATA_CONFLICT" {
		t.Fatal("stale metadata edit was accepted")
	}
	if len(versionList(t, f).Items) != 1 {
		t.Fatal("retries created additional product versions")
	}
}

func TestAutomaticVersionsCoalesceActualContentAndSurviveIdle(t *testing.T) {
	f := newDocument(t)
	repo := docstore.New(f.env.DB)
	body := []document.Block{block("First")}
	for i := 1; i <= 4; i++ {
		body[0].Content[0].Text = fmt.Sprintf("Edit %d", i)
		f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(int64(i), uuid.NewString(), "Draft", body), 200)
		if err := repo.CaptureAutomatic(t.Context(), f.documentID, f.env.Clock.Now().UnixMilli()); err != nil {
			t.Fatal(err)
		}
		f.env.Clock.Advance(10 * time.Second)
	}
	if len(versionList(t, f).Items) != 0 {
		t.Fatal("each save was exposed as a product version")
	}
	f.env.Clock.Advance(document.VersionIdleInterval)
	if err := repo.CaptureAutomatic(t.Context(), f.documentID, f.env.Clock.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	items := versionList(t, f).Items
	if len(items) != 1 || items[0].SourceRevision != 5 {
		t.Fatal("idle capture did not fix the final saved state")
	}
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(5, uuid.NewString(), "Draft", body), 200)
	f.env.Clock.Advance(document.VersionIdleInterval)
	if err := repo.CaptureAutomatic(t.Context(), f.documentID, f.env.Clock.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	if len(versionList(t, f).Items) != 1 {
		t.Fatal("identical content created a redundant automatic version")
	}
	for i := 6; i <= 16; i++ {
		f.env.Clock.Advance(30 * time.Second)
		body[0].Content[0].Text = fmt.Sprintf("Continuous edit %d", i)
		f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(int64(i), uuid.NewString(), "Draft", body), 200)
		if err := repo.CaptureAutomatic(t.Context(), f.documentID, f.env.Clock.Now().UnixMilli()); err != nil {
			t.Fatal(err)
		}
	}
	if len(versionList(t, f).Items) != 2 {
		t.Fatal("continuous editing did not honor the maximum grouping interval")
	}
}

func TestVersionTimelineCursorRemainsStableAcrossNewVersions(t *testing.T) {
	f := newDocument(t)
	first := saveVersion(t, f, 1, "First")
	second := saveVersion(t, f, 1, "Second")
	third := saveVersion(t, f, 1, "Third")
	page := testenv.Decode[document.VersionPage](t, f.env.Call(t, "GET", f.path+"/versions?page_size=1", f.session.AccessToken, nil, 200))
	if len(page.Items) != 1 || page.Items[0].ID != third.ID || page.Pagination.NextCursor == nil {
		t.Fatal("timeline did not return a cursor")
	}
	saveVersion(t, f, 1, "Fourth")
	page = testenv.Decode[document.VersionPage](t, f.env.Call(t, "GET", f.path+"/versions?page_size=2&cursor="+url.QueryEscape(*page.Pagination.NextCursor), f.session.AccessToken, nil, 200))
	if len(page.Items) != 2 || page.Items[0].ID != second.ID || page.Items[1].ID != first.ID || page.Pagination.HasMore || page.Pagination.NextCursor != nil {
		t.Fatal("newly saved versions shifted an existing pagination session")
	}
	f.env.Call(t, "GET", f.path+"/versions?cursor=invalid", f.session.AccessToken, nil, 422)
	f.env.Call(t, "GET", f.path+"/versions?page_size=0", f.session.AccessToken, nil, 422)
}

func TestVersionComparisonAndRestoreKeepAllContentBoundaries(t *testing.T) {
	f := newDocument(t)
	one, two := block("Unchanged"), block("Old text")
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Old title", []document.Block{one, two}), 200)
	before := saveVersion(t, f, 2, "Before")
	two.Content[0].Text = "New text"
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(2, uuid.NewString(), "New title", []document.Block{two, one}), 200)
	after := saveVersion(t, f, 3, "After")
	path := f.path + "/versions/" + after.ID + "/compare?from_id=" + before.ID + "&page_size=1"
	diff := testenv.Decode[document.VersionComparison](t, f.env.Call(t, "GET", path, f.session.AccessToken, nil, 200))
	if len(diff.Items) != 1 || !diff.Pagination.HasMore || diff.Pagination.NextCursor == nil || diff.From.Title != "Old title" || diff.To.Title != "New title" {
		t.Fatal("comparison did not preserve fixed endpoints and pagination")
	}
	next := testenv.Decode[document.VersionComparison](t, f.env.Call(t, "GET", path+"&cursor="+url.QueryEscape(*diff.Pagination.NextCursor), f.session.AccessToken, nil, 200))
	all := append(diff.Items, next.Items...)
	changes := map[string]document.VersionDifference{}
	for _, item := range all {
		changes[item.BlockID] = item
	}
	if changes[one.ID].Change != "moved" || changes[one.ID].ContentChanged || changes[two.ID].Change != "modified" || !changes[two.ID].PositionChanged {
		t.Fatal("comparison confused structural moves with text edits")
	}
	operation := map[string]any{"operation_id": uuid.NewString(), "expected_revision": 3}
	restored := testenv.Decode[content](t, f.env.Call(t, "POST", f.path+"/versions/"+before.ID+"/restore", f.session.AccessToken, operation, 200))
	if restored.Revision.Version != 4 || restored.Revision.Title != "Old title" || restored.Blocks[0].ID != one.ID {
		t.Fatal("version restoration did not create the expected new content boundary")
	}
	retry := testenv.Decode[content](t, f.env.Call(t, "POST", f.path+"/versions/"+before.ID+"/restore", f.session.AccessToken, operation, 200))
	if retry.Revision.Version != 4 {
		t.Fatal("restore retry created another revision")
	}
	list := versionList(t, f)
	kinds := map[string]int{}
	for _, item := range list.Items {
		kinds[item.Kind]++
	}
	if kinds["before_restore"] != 1 || kinds["restored"] != 1 {
		t.Fatal("restore did not retain both recovery boundaries")
	}
	old := testenv.Decode[struct {
		Version document.Version
		Content content
	}](t, f.env.Call(t, "GET", f.path+"/versions/"+after.ID+"/content", f.session.AccessToken, nil, 200))
	if old.Content.Revision.Title != "New title" {
		t.Fatal("restore rewrote the state it replaced")
	}
}

func TestVersionPermissionsValidationAndIntegrity(t *testing.T) {
	f := newDocument(t)
	version := saveVersion(t, f, 1, "Visible")
	viewer := documentMember(t, f, "version-viewer@example.test", "viewer")
	f.env.Call(t, "GET", f.path+"/versions/"+version.ID+"/content", viewer.AccessToken, nil, 200)
	f.env.Call(t, "POST", f.path+"/versions", viewer.AccessToken, map[string]any{"operation_id": uuid.NewString(), "source_revision": 1, "name": "Denied"}, 403)
	f.env.Call(t, "POST", f.path+"/versions/"+version.ID+"/restore", viewer.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_revision": 1}, 403)
	f.env.Call(t, "POST", f.path+"/versions", f.session.AccessToken, map[string]any{"operation_id": uuid.NewString(), "source_revision": 1, "name": strings.Repeat("长", document.VersionNameLimit+1)}, 422)
	f.env.Call(t, "POST", f.path+"/versions", f.session.AccessToken, map[string]any{"operation_id": uuid.NewString(), "source_revision": 99, "name": "Missing"}, 404)
	if err := f.env.DB.Table("document_versions").Where("id=?", version.ID).Update("content_hash", strings.Repeat("0", 64)).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "GET", f.path+"/versions/"+version.ID+"/content", f.session.AccessToken, nil, 500)
	f.env.Call(t, "POST", f.path+"/versions/"+version.ID+"/restore", f.session.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_revision": 1}, 500)
}

func TestConcurrentVersionRequestsAndReceiptRollback(t *testing.T) {
	f := newDocument(t)
	operation := uuid.NewString()
	body, _ := json.Marshal(map[string]any{"operation_id": operation, "source_revision": 1, "name": "Concurrent"})
	var group sync.WaitGroup
	results := make(chan testenv.Result, 2)
	failures := make(chan error, 2)
	for i := 0; i < 2; i++ {
		group.Go(func() {
			request, _ := http.NewRequestWithContext(t.Context(), "POST", f.path+"/versions", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Authorization", "Bearer "+f.session.AccessToken)
			result, err := f.env.DoRequest(request)
			if err != nil {
				failures <- err
				return
			}
			results <- result
		})
	}
	group.Wait()
	close(results)
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for result := range results {
		if result.Status != 201 {
			t.Fatalf("concurrent naming returned %d", result.Status)
		}
		version := testenv.Decode[document.Version](t, result)
		ids[version.ID] = true
	}
	if len(ids) != 1 {
		t.Fatal("concurrent retries produced multiple versions")
	}
	if err := f.env.DB.Exec(`CREATE FUNCTION reject_version_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic receipt failure'; END $$; CREATE TRIGGER reject_version_receipt BEFORE INSERT ON document_version_operations FOR EACH ROW EXECUTE FUNCTION reject_version_receipt();`).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "POST", f.path+"/versions", f.session.AccessToken, map[string]any{"operation_id": uuid.NewString(), "source_revision": 1, "name": "Must roll back"}, 500)
	if len(versionList(t, f).Items) != 1 {
		t.Fatal("receipt failure left an unacknowledged version")
	}
	var current int64
	if err := f.env.DB.Table("documents").Select("content_version").Where("id=?", f.documentID).Scan(&current).Error; err != nil {
		t.Fatal(err)
	}
	if current != 1 {
		t.Fatal("failed version creation changed the document")
	}
}

func TestAutomaticVersionOutboxResumesAfterApplicationRestart(t *testing.T) {
	f := newDocumentWithEnvironment(t, testenv.NewWithQueue(t))
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Pending at restart", []document.Block{block("Durable pending history")}), 200)
	f.env.Clock.Advance(2 * document.VersionIdleInterval)
	f.env.RestartApplication(t)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			t.Fatal("durable pending history was not captured after restart")
		case <-ticker.C:
			var count int64
			if err := f.env.DB.Table("document_versions").Where("document_id=? AND source_revision=2", f.documentID).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count == 1 {
				return
			}
		}
	}
}

func TestVersionPinsAssetsAcrossLaterContentRemoval(t *testing.T) {
	f := newDocument(t)
	assetID := uuid.NewString()
	now := f.env.Clock.Now().UnixMilli()
	if err := f.env.DB.Exec(`INSERT INTO assets(id,owner_id,workspace_id,kind,state,storage_key,filename,media_type,size_bytes,sha256,created_at_ms,updated_at_ms) VALUES(?,?,?,'file','ready',?,'retained.txt','text/plain',1,?,?,?)`, assetID, f.session.User.ID, f.workspaceID, uuid.NewString(), strings.Repeat("a", 64), now, now).Error; err != nil {
		t.Fatal(err)
	}
	body := block("Retained attachment")
	href := "asset:" + assetID
	body.Content[0].Href = &href
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Attachment", []document.Block{body}), 200)
	version := saveVersion(t, f, 2, "Attachment milestone")
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(2, uuid.NewString(), "Removed", []document.Block{}), 200)
	detail := testenv.Decode[struct{ Dependencies []document.VersionDependency }](t, f.env.Call(t, "GET", f.path+"/versions/"+version.ID+"/content", f.session.AccessToken, nil, 200))
	if len(detail.Dependencies) != 1 || detail.Dependencies[0].Kind != "asset" || detail.Dependencies[0].ID != assetID {
		t.Fatal("asset dependency was not recorded")
	}
	if err := f.env.DB.Exec("DELETE FROM assets WHERE id=?", assetID).Error; err == nil {
		t.Fatal("saved-version asset could be physically deleted")
	}
	f.env.Call(t, "GET", f.path+"/versions/"+version.ID+"/content", f.session.AccessToken, nil, 200)
}

func TestVersionManifestProtectsBlocksAndBoundsHistoryReads(t *testing.T) {
	f := newDocument(t)
	body := block("Retained manifest body")
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Manifest", []document.Block{body}), 200)
	version := saveVersion(t, f, 2, "Retained")
	if err := f.env.DB.Exec("INSERT INTO document_revisions(document_id,version,title,author_id,author_name,created_at_ms) SELECT ?,n,'Manifest',?,'Test Owner',? FROM generate_series(3,10002) n", f.documentID, f.session.User.ID, f.env.Clock.Now().UnixMilli()).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.env.DB.Exec("UPDATE document_block_versions SET valid_to=3 WHERE document_id=? AND block_id=? AND valid_from=2", f.documentID, body.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.env.DB.Exec(`INSERT INTO document_block_versions(document_id,block_id,position,payload,valid_from,valid_to)
      SELECT ?,?,0,jsonb_build_object('type','paragraph','props','{}'::jsonb,'content',jsonb_build_array(jsonb_build_object('text','History '||n,'marks','[]'::jsonb,'href',NULL))),n,CASE WHEN n=10002 THEN NULL ELSE n+1 END
      FROM generate_series(3,10002) n`, f.documentID, body.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.env.DB.Exec("UPDATE documents SET content_version=10002 WHERE id=?", f.documentID).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.env.DB.Exec("ANALYZE document_block_versions; ANALYZE document_version_blocks").Error; err != nil {
		t.Fatal(err)
	}
	result := testenv.Decode[struct {
		Version document.Version
		Content content
	}](t, f.env.Call(t, "GET", f.path+"/versions/"+version.ID+"/content", f.session.AccessToken, nil, 200))
	if len(result.Content.Blocks) != 1 || result.Content.Blocks[0].Content[0].Text != "Retained manifest body" {
		t.Fatal("history growth changed manifest resolution")
	}
	var plan string
	if err := f.env.DB.Raw(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT b.* FROM document_version_blocks m JOIN document_block_versions b ON b.document_id=m.document_id AND b.block_id=m.block_id AND b.valid_from=m.block_revision WHERE m.version_id=? AND m.document_id=?`, version.ID, f.documentID).Scan(&plan).Error; err != nil {
		t.Fatal(err)
	}
	var decoded []struct {
		Plan          map[string]any
		ExecutionTime float64 `json:"Execution Time"`
	}
	if err := json.Unmarshal([]byte(plan), &decoded); err != nil {
		t.Fatal(err)
	}
	var check func(map[string]any)
	check = func(node map[string]any) {
		if node["Relation Name"] == "document_block_versions" && node["Node Type"] == "Seq Scan" {
			t.Fatal("fixed version read scanned unrelated block history")
		}
		if children, ok := node["Plans"].([]any); ok {
			for _, child := range children {
				check(child.(map[string]any))
			}
		}
	}
	check(decoded[0].Plan)
	t.Logf("Fixed one-block manifest with 10,000 later revisions: PostgreSQL execution %.3f ms", decoded[0].ExecutionTime)
	if err := f.env.DB.Exec("DELETE FROM document_block_versions WHERE document_id=? AND block_id=? AND valid_from=2", f.documentID, body.ID).Error; err == nil {
		t.Fatal("cleanup could remove a retained version's block")
	}
}
