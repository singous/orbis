//go:build integration

package integration_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"net/http/httptest"
	"net/url"
	"orbis.local/orbis/internal/platform/security"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/tests/testenv"
)

func digest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func beginImport(t *testing.T, f fixture, source []byte) integration.ImportStatus {
	t.Helper()
	return testenv.Decode[integration.ImportStatus](t, f.env.Call(t, "POST", f.agent+"/imports", f.credential.Token, integration.StagedImportInput{OperationID: uuid.NewString(), CollectionID: f.cid, Title: "Imported", SizeBytes: int64(len(source)), SHA256: digest(source)}, 201))
}
func putChunk(t *testing.T, f fixture, id string, offset int, data []byte, status int) testenv.Result {
	t.Helper()
	req := httptest.NewRequest("PUT", f.agent+"/imports/"+id+"/chunks?offset="+strconv.Itoa(offset), bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Authorization", "Bearer "+f.credential.Token)
	req.Header.Set("X-Chunk-SHA256", digest(data))
	result, err := f.env.DoRequest(req)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != status {
		t.Fatalf("chunk status %d: %s", result.Status, result.Body)
	}
	return result
}
func uploadSource(t *testing.T, f fixture, id string, data []byte) {
	t.Helper()
	for offset := 0; offset < len(data); offset += int(integration.MaxImportChunkBytes) {
		putChunk(t, f, id, offset, data[offset:min(offset+int(integration.MaxImportChunkBytes), len(data))], 200)
	}
}
func awaitImport(t *testing.T, f fixture, id string) integration.ImportStatus {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		result := testenv.Decode[integration.ImportStatus](t, f.env.Call(t, "GET", f.agent+"/imports/"+id, f.credential.Token, nil, 200))
		if result.State == "completed" || result.State == "failed" {
			return result
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("import did not reach a terminal state")
	return integration.ImportStatus{}
}
func TestStagedImportResumableChunksAndAtomicReceipt(t *testing.T) {
	f := newAgentIn(t, testenv.NewWithQueue(t), integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}})
	source := []byte(strings.Repeat(strings.Repeat("a", 4096)+"\n\n", 600))
	status := beginImport(t, f, source)
	first := source[:integration.MaxImportChunkBytes]
	putChunk(t, f, status.ID, 0, first, 200)
	putChunk(t, f, status.ID, 0, first, 200)
	changed := append([]byte{}, first...)
	changed[0] = 'B'
	putChunk(t, f, status.ID, 0, changed, 409)
	before := testenv.Decode[integration.ImportStatus](t, f.env.Call(t, "GET", f.agent+"/imports/"+status.ID, f.credential.Token, nil, 200))
	if before.ReceivedBytes != integration.MaxImportChunkBytes {
		t.Fatal("chunk replay advanced progress")
	}
	f.env.Call(t, "POST", f.agent+"/imports/"+status.ID+"/finalize", f.credential.Token, nil, 409)
	uploadSource(t, f, status.ID, source)
	result := f.env.Call(t, "POST", f.agent+"/imports/"+status.ID+"/finalize", f.credential.Token, nil, 202)
	if result.Code != "ACCEPTED" {
		t.Fatal("queued work returned a completion code")
	}
	done := awaitImport(t, f, status.ID)
	if done.State != "completed" || done.Result == nil {
		t.Fatalf("import failed: %+v", done)
	}
	f.env.Call(t, "GET", f.agent+"/documents/"+done.Result.DocumentID+"/content", f.credential.Token, nil, 200)
	op := testenv.Decode[integration.OperationRecord](t, f.env.Call(t, "GET", f.agent+"/operations/"+status.OperationID, f.credential.Token, nil, 200))
	if op.State != "completed" || op.DocumentID == nil || *op.DocumentID != done.Result.DocumentID {
		t.Fatal("document and durable receipt diverged")
	}
	f.env.Call(t, "POST", f.agent+"/imports/"+status.ID+"/finalize", f.credential.Token, nil, 200)
	var count int64
	if err := f.env.DB.Table("documents").Where("collection_id=? AND title=?", f.cid, "Imported").Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("duplicate import document: %d %v", count, err)
	}
	collection := testenv.Decode[struct {
		DirectoryVersion int64 `json:"directory_version"`
	}](t, f.env.Call(t, "GET", f.base+"/collections/"+f.cid, f.owner.AccessToken, nil, 200))
	f.env.Call(t, "PUT", f.base+"/documents/"+done.Result.DocumentID+"/archive", f.owner.AccessToken, map[string]any{"archived": true, "expected_directory_version": collection.DirectoryVersion}, 200)
	f.env.Call(t, "POST", f.agent+"/imports", f.credential.Token, integration.StagedImportInput{OperationID: status.OperationID, CollectionID: f.cid, Title: "Imported", SizeBytes: int64(len(source)), SHA256: digest(source)}, 404)

}
func TestStagedImportRejectsCorruptionWithoutDocument(t *testing.T) {
	f := newAgentIn(t, testenv.NewWithQueue(t), integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}})
	source := []byte("# Integrity\n\nOriginal")
	status := beginImport(t, f, source)
	changed := append([]byte{}, source...)
	changed[len(changed)-1] = 'x'
	uploadSource(t, f, status.ID, changed)
	f.env.Call(t, "POST", f.agent+"/imports/"+status.ID+"/finalize", f.credential.Token, nil, 202)
	done := awaitImport(t, f, status.ID)
	if done.State != "failed" || done.ErrorCode == nil || *done.ErrorCode != "IMPORT_SOURCE_CORRUPT" || done.Result != nil {
		t.Fatalf("corrupt source accepted: %+v", done)
	}
	var count int64
	if err := f.env.DB.Table("documents").Where("collection_id=? AND title=?", f.cid, "Imported").Count(&count).Error; err != nil || count != 0 {
		t.Fatal("failed import left a partial document")
	}
}
func TestStagedImportDisabledDoesNotReserveOperation(t *testing.T) {
	f := newAgent(t, integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}})
	f.env.Call(t, "POST", f.agent+"/imports", f.credential.Token, integration.StagedImportInput{OperationID: uuid.NewString(), CollectionID: f.cid, Title: "Disabled", SHA256: digest(nil)}, 503)
	var count int64
	if err := f.env.DB.Table("integration_imports").Count(&count).Error; err != nil || count != 0 {
		t.Fatal("disabled queue created staging state")
	}
}

func TestStagedImportRecoversObjectAfterChunkTransactionRollback(t *testing.T) {
	f := newAgentIn(t, testenv.NewWithQueue(t), integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}})
	source := []byte("Recovered source")
	status := beginImport(t, f, source)
	sql := `CREATE FUNCTION reject_import_chunk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER reject_import_chunk BEFORE INSERT ON integration_import_chunks FOR EACH ROW EXECUTE FUNCTION reject_import_chunk()`
	if err := f.env.DB.Exec(sql).Error; err != nil {
		t.Fatal(err)
	}
	putChunk(t, f, status.ID, 0, source, 500)
	state := testenv.Decode[integration.ImportStatus](t, f.env.Call(t, "GET", f.agent+"/imports/"+status.ID, f.credential.Token, nil, 200))
	if state.ReceivedBytes != 0 {
		t.Fatal("rolled-back chunk changed progress")
	}
	objects, err := os.ReadDir(f.env.StorageDir)
	if err != nil || len(objects) != 1 {
		t.Fatal("staged bytes were unexpectedly removed")
	}
	if err := f.env.DB.Exec("DROP TRIGGER reject_import_chunk ON integration_import_chunks").Error; err != nil {
		t.Fatal(err)
	}
	putChunk(t, f, status.ID, 0, source, 200)
	objects, err = os.ReadDir(f.env.StorageDir)
	if err != nil || len(objects) != 1 {
		t.Fatal("chunk retry leaked duplicate objects")
	}
	f.env.RestartApplication(t)
	f.env.Call(t, "POST", f.agent+"/imports/"+status.ID+"/finalize", f.credential.Token, nil, 202)
	if done := awaitImport(t, f, status.ID); done.State != "completed" {
		t.Fatalf("retry failed: %+v", done)
	}
}

func TestStagedImportOutboxRecoversQueueLossAfterCommitFailure(t *testing.T) {
	f := newAgentIn(t, testenv.NewWithQueue(t), integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}})
	source := []byte("Atomic completion")
	status := beginImport(t, f, source)
	uploadSource(t, f, status.ID, source)
	sql := `CREATE FUNCTION reject_import_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='import' AND NEW.state='completed' THEN RAISE EXCEPTION 'synthetic receipt failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_import_completion BEFORE UPDATE ON integration_operations FOR EACH ROW EXECUTE FUNCTION reject_import_completion()`
	if err := f.env.DB.Exec(sql).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "POST", f.agent+"/imports/"+status.ID+"/finalize", f.credential.Token, nil, 202)
	options, err := redis.ParseURL(os.Getenv("ORBIS_TEST_REDIS_URL"))
	if err != nil {
		t.Fatal(err)
	}
	client := redis.NewClient(options)
	defer client.Close()
	inspector := asynq.NewInspectorFromRedisClient(client)
	sourceURL, err := url.Parse(f.env.URL)
	if err != nil {
		t.Fatal(err)
	}
	queue := "orbis-imports-" + security.Digest(sourceURL.Host + sourceURL.Path)[:16]
	taskID := "import:" + status.ID
	deadline := time.Now().Add(20 * time.Second)
	observed := false
	for time.Now().Before(deadline) {
		info, err := inspector.GetTaskInfo(queue, taskID)
		if err == nil && info.State == asynq.TaskStateRetry {
			observed = true
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !observed {
		t.Fatal("did not observe the failed commit entering durable retry")
	}
	var count int64
	if err := f.env.DB.Table("documents").Where("collection_id=? AND title=?", f.cid, "Imported").Count(&count).Error; err != nil || count != 0 {
		t.Fatal("failed receipt committed a document")
	}
	f.env.StopApplication(t)
	if err := inspector.DeleteTask(queue, taskID); err != nil {
		t.Fatal(err)
	}
	if err := f.env.DB.Exec("DROP TRIGGER reject_import_completion ON integration_operations").Error; err != nil {
		t.Fatal(err)
	}
	f.env.Clock.Advance(2 * time.Second)
	f.env.RestartApplication(t)
	done := awaitImport(t, f, status.ID)
	if done.State != "completed" || done.Result == nil {
		t.Fatalf("outbox did not recover lost task: %+v", done)
	}
	if err := f.env.DB.Table("documents").Where("collection_id=? AND title=?", f.cid, "Imported").Count(&count).Error; err != nil || count != 1 {
		t.Fatal("recovery did not create exactly one document")
	}
}

func TestStagedImportExpiryAfterCollectionLockWaitDoesNotCommit(t *testing.T) {
	f := newAgentIn(t, testenv.NewWithQueue(t), integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}, ExpiresInDays: 1})
	source := []byte("Expiry after wait")
	status := beginImport(t, f, source)
	uploadSource(t, f, status.ID, source)
	tx := f.env.DB.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	defer tx.Rollback()
	if err := tx.Exec("SELECT id FROM collections WHERE id=? FOR NO KEY UPDATE", f.cid).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "POST", f.agent+"/imports/"+status.ID+"/finalize", f.credential.Token, nil, 202)
	wait := time.Now().Add(15 * time.Second)
	blocked := false
	for time.Now().Before(wait) {
		var count int64
		if err := f.env.DB.Raw("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'").Scan(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count > 0 {
			blocked = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !blocked {
		t.Fatal("worker did not wait on the collection structural lock")
	}
	f.env.Clock.Advance(25 * time.Hour)
	if err := tx.Commit().Error; err != nil {
		t.Fatal(err)
	}
	// The expired bearer cannot observe status; inspect only the owned synthetic database for rollback evidence.
	deadline := time.Now().Add(10 * time.Second)
	var state string
	for time.Now().Before(deadline) {
		if err := f.env.DB.Table("integration_imports").Select("state").Where("id=?", status.ID).Scan(&state).Error; err != nil {
			t.Fatal(err)
		}
		if state == "failed" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if state != "failed" {
		t.Fatalf("expired work did not fail: %s", state)
	}
	var code string
	if err := f.env.DB.Table("integration_imports").Select("error_code").Where("id=?", status.ID).Scan(&code).Error; err != nil || code != "INTEGRATION_TOKEN_INVALID" {
		t.Fatalf("unexpected expiry code: %s %v", code, err)
	}
	var count int64
	if err := f.env.DB.Table("documents").Where("collection_id=? AND title=?", f.cid, "Imported").Count(&count).Error; err != nil || count != 0 {
		t.Fatal("expired work committed content")
	}
}

func TestStagedImportCleanupPreservesDocumentAndUnrelatedFiles(t *testing.T) {
	f := newAgentIn(t, testenv.NewWithQueue(t), integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite}})
	source := []byte("Retained document content")
	doneID := beginImport(t, f, source)
	uploadSource(t, f, doneID.ID, source)
	f.env.Call(t, "POST", f.agent+"/imports/"+doneID.ID+"/finalize", f.credential.Token, nil, 202)
	done := awaitImport(t, f, doneID.ID)
	if done.Result == nil {
		t.Fatal("document not committed")
	}
	pending := beginImport(t, f, source)
	uploadSource(t, f, pending.ID, source)
	unrelated := filepath.Join(f.env.StorageDir, uuid.NewString()+".blob")
	if err := os.WriteFile(unrelated, []byte("unrelated private object"), 0600); err != nil {
		t.Fatal(err)
	}
	f.env.Clock.Advance(8 * 24 * time.Hour)
	count, err := f.env.CleanupImports(t.Context())
	if err != nil || count != 2 {
		t.Fatalf("cleanup: %d %v", count, err)
	}
	if _, err := os.Stat(unrelated); err != nil {
		t.Fatal("cleanup removed an unrelated object")
	}
	f.env.Call(t, "GET", f.agent+"/documents/"+done.Result.DocumentID+"/content", f.credential.Token, nil, 200)
	expired := testenv.Decode[integration.ImportStatus](t, f.env.Call(t, "GET", f.agent+"/imports/"+pending.ID, f.credential.Token, nil, 200))
	if expired.State != "failed" || expired.ErrorCode == nil || *expired.ErrorCode != "IMPORT_EXPIRED" {
		t.Fatal("expired source did not retain a clear terminal state")
	}
	count, err = f.env.CleanupImports(t.Context())
	if err != nil || count != 0 {
		t.Fatal("cleanup was not repeatable")
	}
}
