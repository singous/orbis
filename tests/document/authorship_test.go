//go:build integration

package document_test

import (
	"testing"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/tests/testenv"
)

func TestRevisionAuthorshipPreservesSnapshotAndAnonymousHistory(t *testing.T) {
	f := newDocument(t)
	type revision struct {
		Title      string
		AuthorID   *string `json:"author_id"`
		AuthorName string  `json:"author_name"`
		Version    int64
	}
	type content struct{ Revision revision }
	before := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200))
	if before.Revision.AuthorID == nil || before.Revision.AuthorName != "Test Owner" {
		t.Fatal("new revision did not snapshot its author")
	}
	f.env.Call(t, "PATCH", "/api/v1/me", f.session.AccessToken, map[string]any{"expected_version": 1, "display_name": "Updated author"}, 200)
	f.env.Call(t, "PUT", f.path+"/content", f.session.AccessToken, writeBody(1, uuid.NewString(), "Authorship", []document.Block{}), 200)
	old := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content?version=1", f.session.AccessToken, nil, 200))
	if old.Revision.AuthorName != "Test Owner" {
		t.Fatal("profile update rewrote historical authorship")
	}
	now := f.env.Clock.Now().UnixMilli()
	tx := f.env.DB.Begin()
	defer tx.Rollback()
	if err := tx.Exec("INSERT INTO document_revisions(document_id,version,title,author_id,author_name,title_recorded,created_at_ms) VALUES (?,3,?,NULL,?,FALSE,?)", f.documentID, "Anonymous history", "Historical author", now).Error; err != nil {
		t.Fatal(err)
	}
	if err := tx.Exec("UPDATE documents SET content_version=3,title=? WHERE id=?", "Keep current title", f.documentID).Error; err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit().Error; err != nil {
		t.Fatal(err)
	}
	anonymous := testenv.Decode[content](t, f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200))
	if anonymous.Revision.AuthorID != nil || anonymous.Revision.AuthorName != "Historical author" {
		t.Fatal("anonymous author was fabricated or dropped")
	}
	restored := testenv.Decode[content](t, f.env.Call(t, "POST", f.path+"/restore", f.session.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 3, "source_version": 3}, 200))
	if restored.Revision.Title != "Keep current title" {
		t.Fatal("restoring history with an unrecorded title overwrote the current title")
	}
	if restored.Revision.AuthorID == nil || *restored.Revision.AuthorID != f.session.User.ID || restored.Revision.AuthorName != "Updated author" {
		t.Fatal("restoration attributed the new write to the old author")
	}
}
func TestInactiveAuthorsRemainVisibleWhenOthersResolveComments(t *testing.T) {
	f := newDocument(t)
	author := documentMember(t, f, "inactive-author@example.test", "viewer")
	path := f.path + "/comments"
	row := testenv.Decode[comment](t, f.env.Call(t, "POST", path, author.AccessToken, map[string]any{"body": "Retained comment"}, 201))
	if err := f.env.DB.Table("users").Where("id=?", author.User.ID).Update("is_active", false).Error; err != nil {
		t.Fatal(err)
	}
	resolved := testenv.Decode[comment](t, f.env.Call(t, "PATCH", path+"/"+row.ID, f.session.AccessToken, map[string]any{"expected_version": 1, "is_resolved": true}, 200))
	if !resolved.IsResolved || resolved.AuthorName != "Test User" {
		t.Fatal("inactive author's retained comment became inaccessible")
	}
}
