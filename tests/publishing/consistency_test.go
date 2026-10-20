//go:build integration

package publishing_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/tests/testenv"
)

func TestSiteReceiptFailureRollsBackCompleteRelease(t *testing.T) {
	f := newSite(t)
	input := publishing.PublishInput{OperationID: uuid.NewString(), ExpectedVersion: f.site.Version, ExpectedSourceFingerprint: f.preview(t).SourceFingerprint}
	if err := f.env.DB.Exec(`CREATE FUNCTION reject_site_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$`).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.env.DB.Exec(`CREATE TRIGGER reject_site_receipt BEFORE INSERT ON site_operations FOR EACH ROW EXECUTE FUNCTION reject_site_receipt()`).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "POST", f.path+"/publish", f.session.AccessToken, input, 500)
	for _, name := range []string{"site_releases", "site_release_pages", "published_page_bodies", "site_release_assets", "site_release_tables", "site_operations"} {
		var count int64
		if err := f.env.DB.Table(name).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("failed release leaked %s rows", name)
		}
	}
	current := testenv.Decode[site](t, f.env.Call(t, "GET", f.path, f.session.AccessToken, nil, 200))
	if current.Version != f.site.Version || current.PublishedReleaseID != nil {
		t.Fatal("failed release changed active pointer")
	}
	if err := f.env.DB.Exec("DROP TRIGGER reject_site_receipt ON site_operations").Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "POST", f.path+"/publish", f.session.AccessToken, input, 201)
}
func waitBlocked(t *testing.T, f fixture, pattern string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var blocked bool
		if err := f.env.DB.WithContext(ctx).Raw("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE ?)", pattern).Scan(&blocked).Error; err != nil {
			t.Fatal(err)
		}
		if blocked {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("operation did not wait for its database lock")
		case <-ticker.C:
		}
	}
}
func TestSitePublishChecksSourceAfterWaitingForDocument(t *testing.T) {
	f := newSite(t)
	preview := f.preview(t)
	tx := f.env.DB.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	defer tx.Rollback()
	if err := tx.Exec("SELECT id FROM documents WHERE id=? FOR UPDATE", f.did).Error; err != nil {
		t.Fatal(err)
	}
	done := make(chan testenv.Result, 1)
	fail := make(chan error, 1)
	go func() {
		result, err := f.env.Do("POST", f.path+"/publish", f.session.AccessToken, publishing.PublishInput{OperationID: uuid.NewString(), ExpectedVersion: f.site.Version, ExpectedSourceFingerprint: preview.SourceFingerprint})
		done <- result
		fail <- err
	}()
	waitBlocked(t, f, "%documents%FOR SHARE%")
	// A title-only revision is committed through the same locked document before publication can read it.
	if err := tx.Exec("INSERT INTO document_revisions(document_id,version,title,author_id,created_at_ms) VALUES(?,2,'Changed under lock',?,?)", f.did, f.session.User.ID, f.env.Clock.Now().UnixMilli()).Error; err != nil {
		t.Fatal(err)
	}
	if err := tx.Exec("UPDATE documents SET content_version=2,title='Changed under lock' WHERE id=?", f.did).Error; err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit().Error; err != nil {
		t.Fatal(err)
	}
	result := <-done
	if err := <-fail; err != nil {
		t.Fatal(err)
	}
	if result.Status != 409 || result.Code != "SITE_SOURCE_CONFLICT" {
		t.Fatalf("published a stale preview: %+v", result)
	}
}
func TestIndependentSitePublishesReuseBodiesWithoutDeadlock(t *testing.T) {
	f := newSite(t)
	f.write(t, "One", []document.Block{paragraph("Shared body one")})
	otherDoc := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", f.base+"/collections/"+f.cid+"/documents", f.session.AccessToken, map[string]any{"title": "Two"}, 201))
	f.env.Call(t, "PUT", f.base+"/documents/"+otherDoc.ID+"/content", f.session.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": 1, "title": "Two", "blocks": []document.Block{paragraph("Shared body two")}}, 200)
	config := f.site.Config
	config.Navigation = append(config.Navigation, publishing.Navigation{DocumentID: otherDoc.ID, Slug: "second", Title: "Second"})
	f.site = f.save(t, config)
	reversed := []publishing.Navigation{f.site.Navigation[1], f.site.Navigation[0]}
	second := testenv.Decode[site](t, f.env.Call(t, "POST", f.base+"/sites", f.session.AccessToken, publishing.Config{Name: "Second", Slug: "second-site", Navigation: reversed}, 201))
	other := f
	other.site = second
	other.path = f.base + "/sites/" + second.ID
	previews := []publishing.Preview{f.preview(t), other.preview(t)}
	fixtures := []fixture{f, other}
	var wg sync.WaitGroup
	results := make([]testenv.Result, 2)
	errs := make([]error, 2)
	start := make(chan struct{})
	for i := range fixtures {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			v := fixtures[i]
			results[i], errs[i] = v.env.Do("POST", v.path+"/publish", v.session.AccessToken, publishing.PublishInput{OperationID: uuid.NewString(), ExpectedVersion: v.site.Version, ExpectedSourceFingerprint: previews[i].SourceFingerprint})
		}()
	}
	close(start)
	wg.Wait()
	for i := range results {
		if errs[i] != nil || results[i].Status != 201 {
			t.Fatalf("independent publish failed: %+v %v", results[i], errs[i])
		}
	}
	var bodies int64
	if err := f.env.DB.Table("published_page_bodies").Count(&bodies).Error; err != nil {
		t.Fatal(err)
	}
	if bodies != 2 {
		t.Fatal("identical public bodies were not reused")
	}
}
