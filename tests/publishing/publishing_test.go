//go:build integration

package publishing_test

import (
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/tests/testenv"
)

type site struct {
	publishing.Config
	ID                 string
	Version            int64
	PublishedReleaseID *string `json:"published_release_id"`
	PublishedSlug      *string `json:"published_slug"`
}
type mutation struct {
	Site    site
	Release *publishing.Release
}
type fixture struct {
	env                                *testenv.Environment
	session                            testenv.Session
	wid, cid, did, base, docPath, path string
	site                               site
	contentVersion                     int64
}

func newSite(t *testing.T) fixture {
	t.Helper()
	return newSiteWithEnvironment(t, testenv.New(t))
}
func newSiteWithEnvironment(t *testing.T, e *testenv.Environment) fixture {
	t.Helper()
	session, wid := e.Owner(t)
	base := "/api/v1/workspaces/" + wid
	c := testenv.Decode[struct{ ID string }](t, e.Call(t, "POST", base+"/collections", session.AccessToken, map[string]any{"title": "Source"}, 201))
	d := testenv.Decode[struct{ ID string }](t, e.Call(t, "POST", base+"/collections/"+c.ID+"/documents", session.AccessToken, map[string]any{"title": "Document"}, 201))
	config := publishing.Config{Name: "Public site", Slug: "public-site", Navigation: []publishing.Navigation{{DocumentID: d.ID, Slug: "guide/start", Title: "Guide"}}}
	created := testenv.Decode[site](t, e.Call(t, "POST", base+"/sites", session.AccessToken, config, 201))
	return fixture{env: e, session: session, wid: wid, cid: c.ID, did: d.ID, base: base, docPath: base + "/documents/" + d.ID, path: base + "/sites/" + created.ID, site: created, contentVersion: 1}
}
func (f *fixture) write(t *testing.T, title string, blocks []document.Block) {
	t.Helper()
	f.env.Call(t, "PUT", f.docPath+"/content", f.session.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": f.contentVersion, "title": title, "blocks": blocks}, 200)
	f.contentVersion++
}
func paragraph(text string) document.Block {
	return document.Block{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: text}}}
}
func (f fixture) preview(t *testing.T) publishing.Preview {
	t.Helper()
	return testenv.Decode[publishing.Preview](t, f.env.Call(t, "GET", f.path+"/preview", f.session.AccessToken, nil, 200))
}
func (f *fixture) publish(t *testing.T) mutation {
	t.Helper()
	preview := f.preview(t)
	result := testenv.Decode[mutation](t, f.env.Call(t, "POST", f.path+"/publish", f.session.AccessToken, publishing.PublishInput{OperationID: uuid.NewString(), ExpectedVersion: f.site.Version, ExpectedSourceFingerprint: preview.SourceFingerprint}, 201))
	f.site = result.Site
	return result
}
func (f fixture) save(t *testing.T, config publishing.Config) site {
	t.Helper()
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(encoded, &body); err != nil {
		t.Fatal(err)
	}
	body["expected_version"] = f.site.Version
	return testenv.Decode[site](t, f.env.Call(t, "PUT", f.path, f.session.AccessToken, body, 200))
}
func TestSitePublishSnapshotActivationAndRevocation(t *testing.T) {
	f := newSite(t)
	f.write(t, "Draft title", []document.Block{paragraph("First public content")})
	first := f.publish(t)
	if first.Release == nil || first.Release.Number != 1 || first.Site.Version != 2 {
		t.Fatal("invalid first release")
	}
	public := "/api/v1/public/sites/public-site"
	manifest := testenv.Decode[publishing.Snapshot](t, f.env.Call(t, "GET", public+"/manifest", "", nil, 200))
	if len(manifest.Pages) != 1 || manifest.ReleaseID == nil || *manifest.ReleaseID != first.Release.ID {
		t.Fatal("public metadata not atomically activated")
	}
	page := testenv.Decode[publishing.Page](t, f.env.Call(t, "GET", public+"/pages/guide/start", "", nil, 200))
	if !strings.Contains(page.PlainText, "First public content") {
		t.Fatal("public body missing")
	}
	f.write(t, "Draft edit", []document.Block{paragraph("Second public content")})
	page = testenv.Decode[publishing.Page](t, f.env.Call(t, "GET", public+"/pages/guide/start", "", nil, 200))
	if strings.Contains(page.PlainText, "Second") {
		t.Fatal("draft changed immutable release")
	}
	second := f.publish(t)
	f.env.Call(t, "GET", public+"/pages/guide/start?release_id="+first.Release.ID, "", nil, 409)
	f.env.Call(t, "POST", f.path+"/activation", f.session.AccessToken, publishing.ActivateInput{OperationID: uuid.NewString(), ExpectedVersion: f.site.Version, ReleaseID: &first.Release.ID}, 200)
	f.site.Version++
	page = testenv.Decode[publishing.Page](t, f.env.Call(t, "GET", public+"/pages/guide/start", "", nil, 200))
	if !strings.Contains(page.PlainText, "First") {
		t.Fatal("activation did not select historical body")
	}
	if second.Release.Number != 2 {
		t.Fatal("release sequence changed")
	}
	f.env.Call(t, "POST", f.path+"/activation", f.session.AccessToken, publishing.ActivateInput{OperationID: uuid.NewString(), ExpectedVersion: f.site.Version}, 200)
	f.env.Call(t, "GET", public+"/manifest", "", nil, 404)
	f.env.Call(t, "GET", public+"/pages/guide/start", "", nil, 404)
}
func TestSitePublishChecksPreviewAndReplaysOnce(t *testing.T) {
	f := newSite(t)
	preview := f.preview(t)
	f.write(t, "Changed", []document.Block{paragraph("new content")})
	input := publishing.PublishInput{OperationID: uuid.NewString(), ExpectedVersion: f.site.Version, ExpectedSourceFingerprint: preview.SourceFingerprint}
	f.env.Call(t, "POST", f.path+"/publish", f.session.AccessToken, input, 409)
	preview = f.preview(t)
	input.ExpectedSourceFingerprint = preview.SourceFingerprint
	results := make([]testenv.Result, 2)
	errs := make([]error, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results[i], errs[i] = f.env.Do("POST", f.path+"/publish", f.session.AccessToken, input)
		}()
	}
	close(start)
	wg.Wait()
	for i := range results {
		if errs[i] != nil || results[i].Status != 201 {
			t.Fatalf("concurrent replay: %+v %v", results[i], errs[i])
		}
	}
	a, b := testenv.Decode[mutation](t, results[0]), testenv.Decode[mutation](t, results[1])
	if a.Release.ID != b.Release.ID {
		t.Fatal("retry published twice")
	}
	input.ExpectedSourceFingerprint = strings.Repeat("0", 64)
	f.env.Call(t, "POST", f.path+"/publish", f.session.AccessToken, input, 409)
	var count int64
	if err := f.env.DB.Table("site_releases").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("failed publish leaked a release")
	}
}
func TestSiteSourcesHierarchyPathsAndExclusions(t *testing.T) {
	f := newSite(t)
	child := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", f.base+"/collections/"+f.cid+"/documents", f.session.AccessToken, map[string]any{"title": "Child page", "parent_id": f.did}, 201))
	config := f.site.Config
	config.Navigation = []publishing.Navigation{}
	config.Source = publishing.Source{Kind: "collections", Collections: []publishing.CollectionBinding{{CollectionID: f.cid}}}
	f.site = f.save(t, config)
	source := testenv.Decode[publishing.Sources](t, f.env.Call(t, "GET", f.path+"/sources", f.session.AccessToken, nil, 200))
	if len(source.Pages) != 2 || source.Pages[1].ParentSlug == nil || *source.Pages[1].ParentSlug != source.Pages[0].Slug {
		t.Fatal("source hierarchy lost")
	}
	f.publish(t)
	original := source.Pages[0].Slug
	f.write(t, "Renamed", []document.Block{paragraph("changed")})
	source = testenv.Decode[publishing.Sources](t, f.env.Call(t, "GET", f.path+"/sources", f.session.AccessToken, nil, 200))
	if source.Pages[0].Slug != original || len(source.Changes.Modified) != 1 {
		t.Fatal("rename changed stable automatic path")
	}
	alternate := "new/path"
	config = f.site.Config
	config.Source.PageOverrides = []publishing.Override{{DocumentID: f.did, Slug: &alternate}}
	f.site = f.save(t, config)
	preview := f.preview(t)
	if preview.Snapshot.Redirects[original] != alternate {
		t.Fatal("path change lost redirect")
	}
	config = f.site.Config
	config.Source.ExcludedDocumentIDs = []string{f.did}
	f.site = f.save(t, config)
	source = testenv.Decode[publishing.Sources](t, f.env.Call(t, "GET", f.path+"/sources", f.session.AccessToken, nil, 200))
	if len(source.Pages) != 0 || source.ExcludedCount != 2 {
		t.Fatalf("excluded subtree not applied: %+v", source)
	}
	if child.ID == "" {
		t.Fatal("invalid fixture")
	}
}
func TestSitePermissionsAndSlugReservations(t *testing.T) {
	f := newSite(t)
	viewer := f.env.AddUser(t, "viewer@example.test")
	editor := f.env.AddUser(t, "editor@example.test")
	now := f.env.Clock.Now().UnixMilli()
	for _, entry := range []struct{ user, role string }{{viewer.User.ID, "viewer"}, {editor.User.ID, "editor"}} {
		if err := f.env.DB.Exec("INSERT INTO workspace_members(workspace_id,user_id,role,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?)", f.wid, entry.user, entry.role, now, now).Error; err != nil {
			t.Fatal(err)
		}
	}
	f.env.Call(t, "GET", f.path+"/preview", viewer.AccessToken, nil, 200)
	f.env.Call(t, "POST", f.base+"/sites", viewer.AccessToken, publishing.Config{Name: "No", Slug: "denied"}, 403)
	preview := f.preview(t)
	f.env.Call(t, "POST", f.path+"/publish", editor.AccessToken, publishing.PublishInput{OperationID: uuid.NewString(), ExpectedVersion: f.site.Version, ExpectedSourceFingerprint: preview.SourceFingerprint}, 403)
	f.publish(t)
	config := f.site.Config
	config.Slug = "draft-renamed"
	f.site = f.save(t, config)
	for _, slug := range []string{"public-site", "draft-renamed"} {
		f.env.Call(t, "POST", f.base+"/sites", f.session.AccessToken, publishing.Config{Name: "Conflict", Slug: slug}, 409)
	}
	f.env.Call(t, "POST", f.path+"/activation", f.session.AccessToken, publishing.ActivateInput{OperationID: uuid.NewString(), ExpectedVersion: f.site.Version}, 200)
	f.env.Call(t, "POST", f.base+"/sites", f.session.AccessToken, publishing.Config{Name: "Released slug", Slug: "public-site"}, 201)
	f.env.Call(t, "GET", f.path+"/releases?page_size=1&page="+strconv.Itoa(1), viewer.AccessToken, nil, 200)
}
