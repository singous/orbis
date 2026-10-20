//go:build integration

package integration_test

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"mime/multipart"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/integration"
	"orbis.local/orbis/internal/sharing"
	"orbis.local/orbis/tests/testenv"
)

func uploadAgent(t *testing.T, f fixture, operation string, data []byte, status int) integration.UploadedFile {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", "report.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	request := httptest.NewRequest("POST", f.agent+"/documents/"+f.did+"/assets?operation_id="+operation+"&sha256="+digest+"&size_bytes="+strconv.Itoa(len(data)), &body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+f.credential.Token)
	result, err := f.env.DoRequest(request)
	if err != nil || result.Status != status {
		t.Fatalf("upload status=%d want=%d: %s %v", result.Status, status, result.Body, err)
	}
	if status != 201 {
		return integration.UploadedFile{}
	}
	return testenv.Decode[integration.UploadedFile](t, result)
}
func TestAgentFileUploadBindingAndExplicitPublicReference(t *testing.T) {
	f := newAgent(t, integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite, integration.AssetsRead, integration.AssetsWrite}})
	operation := uuid.NewString()
	data := []byte("private attachment bytes")
	first := uploadAgent(t, f, operation, data, 201)
	second := uploadAgent(t, f, operation, data, 201)
	if first.ID != second.ID || first.SHA256 != fmt.Sprintf("%x", sha256.Sum256(data)) {
		t.Fatal("attachment upload retry was not stable")
	}
	prefix := f.agent + "/documents/" + f.did + "/assets/" + first.ID
	f.env.Call(t, "GET", prefix, f.credential.Token, nil, 200)
	downloaded := f.env.Call(t, "GET", prefix+"/content", f.credential.Token, nil, 200)
	if !bytes.Equal(downloaded.Body, data) {
		t.Fatal("attachment bytes changed")
	}
	f.env.Call(t, "GET", f.agent+"/documents/"+f.other+"/assets/"+first.ID, f.credential.Token, nil, 404)
	share := testenv.Decode[struct{ Token string }](t, f.env.Call(t, "POST", f.base+"/shares", f.owner.AccessToken, sharing.CreateInput{CollectionID: f.cid, RootDocumentID: &f.did, AcknowledgePublicScope: true}, 201))
	public := "/api/v1/public/shares/" + share.Token + "/documents/" + f.did + "/assets/" + first.ID
	f.env.Call(t, "GET", public, "", nil, 404)
	payload := first.BlockTemplate
	f.env.Call(t, "POST", f.agent+"/documents/"+f.did+"/operations", f.credential.Token, document.CommandsInput{OperationID: uuid.NewString(), ExpectedVersion: 2, Operations: []document.Operation{{Type: "insert_blocks", Blocks: []document.Block{{ID: uuid.NewString(), Type: payload.Type, Props: payload.Props, Content: payload.Content}}}}}, 200)
	f.env.Call(t, "GET", public, "", nil, 200)
}
func TestAgentUploadRecoversBytesAfterReceiptCommitFailure(t *testing.T) {
	f := newAgent(t, integration.TokenInput{Permissions: []integration.Permission{integration.DocumentsRead, integration.DocumentsWrite, integration.AssetsRead, integration.AssetsWrite}})
	if err := f.env.DB.Exec(`CREATE FUNCTION reject_upload_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='completed' THEN RAISE EXCEPTION 'synthetic upload receipt failure'; END IF; RETURN NEW; END $$`).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.env.DB.Exec(`CREATE TRIGGER reject_upload_result BEFORE UPDATE ON integration_operations FOR EACH ROW EXECUTE FUNCTION reject_upload_result()`).Error; err != nil {
		t.Fatal(err)
	}
	operation := uuid.NewString()
	data := []byte("durable object before uncertain commit")
	uploadAgent(t, f, operation, data, 500)
	var staged struct{ ID, State string }
	if err := f.env.DB.Table("assets").Select("id,state").Where("workspace_id=?", f.wid).Take(&staged).Error; err != nil {
		t.Fatal(err)
	}
	if staged.State != "staging" {
		t.Fatal("failed receipt made bytes visible")
	}
	var count int64
	if err := f.env.DB.Table("integration_attachments").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("failed receipt leaked an attachment grant")
	}
	if err := f.env.DB.Exec("DROP TRIGGER reject_upload_result ON integration_operations").Error; err != nil {
		t.Fatal(err)
	}
	recovered := uploadAgent(t, f, operation, data, 201)
	if recovered.ID != staged.ID {
		t.Fatal("retry created a second object")
	}
	if err := f.env.DB.Table("assets").Where("workspace_id=?", f.wid).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("upload recovery duplicated metadata")
	}
	result := f.env.Call(t, "GET", f.agent+"/operations/"+operation, f.credential.Token, nil, 200)
	if !strings.Contains(string(result.Data), "completed") {
		t.Fatal("recovered upload has no committed receipt")
	}
}
