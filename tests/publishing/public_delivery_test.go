//go:build integration

package publishing_test

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"mime/multipart"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"

	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/internal/table"
	"orbis.local/orbis/tests/testenv"
)

func uploadImage(t *testing.T, f fixture) string {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("file", "public.png")
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(part, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", f.base+"/assets", &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+f.session.AccessToken)
	result, err := f.env.DoRequest(req)
	if err != nil || result.Status != 201 {
		t.Fatalf("upload: %+v %v", result, err)
	}
	return testenv.Decode[struct{ ID string }](t, result).ID
}
func TestPublishedAssetsAreExplicitGrantsAndRevokeWithRelease(t *testing.T) {
	f := newSite(t)
	included := uploadImage(t, f)
	unrelated := uploadImage(t, f)
	f.write(t, "Media", []document.Block{{ID: uuid.NewString(), Type: "image", Props: map[string]any{"source": map[string]any{"type": "asset", "asset_id": included}, "alt": "public image"}}})
	release := f.publish(t)
	page := testenv.Decode[publishing.Page](t, f.env.Call(t, "GET", "/api/v1/public/sites/public-site/pages/guide/start", "", nil, 200))
	source := page.Blocks[0].Props["source"].(map[string]any)
	address := source["url"].(string)
	if strings.Contains(address, f.wid) || strings.Contains(string(f.env.Call(t, "GET", "/api/v1/public/sites/public-site/pages/guide/start", "", nil, 200).Data), "storage_key") {
		t.Fatal("public asset projection leaked private location")
	}
	get := f.env.Call(t, "GET", address, "", nil, 200)
	head := f.env.Call(t, "HEAD", address, "", nil, 200)
	if len(get.Body) == 0 || get.Header.Get("Content-Type") != "image/png" || len(head.Body) != 0 || get.Header.Get("Content-Length") != head.Header.Get("Content-Length") {
		t.Fatal("invalid published image delivery")
	}
	f.env.Call(t, "GET", "/api/v1/public/sites/public-site/assets/"+unrelated, "", nil, 404)
	f.env.Call(t, "POST", f.path+"/activation", f.session.AccessToken, publishing.ActivateInput{OperationID: uuid.NewString(), ExpectedVersion: f.site.Version}, 200)
	f.env.Call(t, "GET", address, "", nil, 404)
	if release.Release.ID == "" {
		t.Fatal("missing release")
	}
}
func TestPublishedTablesFilterAndRemovePrivateDefinition(t *testing.T) {
	f := newSite(t)
	blockID := uuid.NewString()
	f.write(t, "Data", []document.Block{{ID: blockID, Type: "data_table"}})
	publicField, privateField, viewID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	definition := table.Definition{Title: "Published data", Fields: []table.Field{{ID: publicField, Name: "Public", Kind: "text"}, {ID: privateField, Name: "Secret field", Kind: "text"}}, Views: []table.View{{ID: viewID, Name: "Reader", Kind: "grid", Filters: []table.Filter{{FieldID: privateField, Operator: "eq", Value: "private-selector"}}}}, PublicViewID: viewID, PublicFieldIDs: []string{publicField}}
	created := testenv.Decode[table.Result](t, f.env.Call(t, "POST", f.docPath+"/tables", f.session.AccessToken, table.CreateInput{OperationID: uuid.NewString(), ExpectedDocumentVersion: f.contentVersion, BlockID: blockID, Definition: &definition}, 201))
	f.contentVersion = created.ContentVersion
	firstID, secondID := uuid.NewString(), uuid.NewString()
	changed := testenv.Decode[table.Result](t, f.env.Call(t, "POST", f.docPath+"/tables/"+created.TableID+"/changes", f.session.AccessToken, table.MutationInput{OperationID: uuid.NewString(), ExpectedDocumentVersion: f.contentVersion, ExpectedTableVersion: created.TableVersion, Changes: table.Changes{Upserts: []table.Upsert{{ID: firstID, Values: map[string]any{publicField: "visible", privateField: "private-selector"}}, {ID: secondID, Values: map[string]any{publicField: "not-selected", privateField: "other"}}}}}, 200))
	f.contentVersion = changed.ContentVersion
	f.publish(t)
	raw := f.env.Call(t, "GET", "/api/v1/public/sites/public-site/pages/guide/start", "", nil, 200)
	for _, private := range []string{"Secret field", "private-selector", privateField, "filters", "sorts", created.TableID, f.did, f.wid} {
		if strings.Contains(string(raw.Data), private) {
			t.Fatalf("public table leaked %q", private)
		}
	}
	page := testenv.Decode[publishing.Page](t, raw)
	ref := page.Blocks[0].DataTable
	if ref == nil || ref.Total != 1 || len(ref.Items) != 1 || ref.Items[0].Values[publicField] != "visible" {
		t.Fatal("public view projection missing")
	}
	response := f.env.Call(t, "GET", ref.RecordsURL, "", nil, 200)
	if strings.Contains(string(response.Data), privateField) || strings.Contains(string(response.Data), "private-selector") {
		t.Fatal("published record endpoint leaked hidden values")
	}
	f.env.Call(t, "GET", "/api/v1/public/sites/public-site/tables/"+created.TableID+"/records", "", nil, 404)
	f.env.Call(t, "POST", f.docPath+"/tables/"+created.TableID+"/changes", f.session.AccessToken, table.MutationInput{OperationID: uuid.NewString(), ExpectedDocumentVersion: f.contentVersion, ExpectedTableVersion: changed.TableVersion, Changes: table.Changes{Upserts: []table.Upsert{{ID: firstID, Values: map[string]any{publicField: "edited after publication"}}}}}, 200)
	frozen := f.env.Call(t, "GET", ref.RecordsURL, "", nil, 200)
	if strings.Contains(string(frozen.Data), "edited after publication") {
		t.Fatal("published table followed live draft")
	}
	md := f.env.Call(t, "GET", "/s/public-site/pages/guide/start.md", "", nil, 200)
	if !strings.Contains(string(md.Body), "visible") || strings.Contains(string(md.Body), "private-selector") || strings.Contains(string(md.Body), "not-selected") {
		t.Fatalf("markdown table projection failed: %s", md.Body)
	}
}
func TestPublicHTMLAndMachineExportsUseSameRelease(t *testing.T) {
	f := newSite(t)
	f.write(t, "Source", []document.Block{{ID: uuid.NewString(), Type: "heading", Props: map[string]any{"level": 2}, Content: []document.TextRun{{Text: "章节标题"}}}, paragraph("Visible body <script>alert(1)</script>")})
	f.publish(t)
	html := f.env.Call(t, "GET", "/s/public-site/guide/start", "", nil, 200)
	text := string(html.Body)
	for _, part := range []string{"<!doctype html>", "Visible body &lt;script&gt;", "rel=\"canonical\"", "正文目录", "id=\"章节标题\"", "data-theme-toggle"} {
		if !strings.Contains(text, part) {
			t.Fatalf("missing HTML output %q", part)
		}
	}
	if strings.Contains(text, "<script>alert(1)</script>") {
		t.Fatal("HTML executed author text")
	}
	for _, path := range []string{"sitemap.xml", "robots.txt", "llms.txt", "llms-full.txt", "pages/guide/start.md"} {
		response := f.env.Call(t, "GET", "/s/public-site/"+path, "", nil, 200)
		if len(response.Body) == 0 {
			t.Fatal("empty export")
		}
		f.env.Call(t, "HEAD", "/s/public-site/"+path, "", nil, 200)
	}
	search := f.env.Call(t, "GET", "/s/public-site?q=Visible", "", nil, 200)
	if !strings.Contains(string(search.Body), "搜索结果") || !strings.Contains(string(search.Body), "Guide") {
		t.Fatal("server search reader missing")
	}
	css := f.env.Call(t, "GET", "/api/v1/public/reader.css", "", nil, 200)
	if !strings.Contains(string(css.Body), "max-width:760px") {
		t.Fatal("responsive reader style missing")
	}
	script := f.env.Call(t, "GET", "/api/v1/public/reader.js", "", nil, 200)
	if !strings.Contains(string(script.Body), "textContent") {
		t.Fatal("reader script missing")
	}
	f.env.Call(t, "GET", "/s/public-site/missing", "", nil, 404)
}

func TestPublishedInlineAssetLinksAndBrandDownloads(t *testing.T) {
	f := newSite(t)
	file := uploadImage(t, f)
	reference := document.AssetLink(file)
	f.write(t, "Links", []document.Block{{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "Download", Href: &reference}}}, {ID: uuid.NewString(), Type: "card", Props: map[string]any{"title": "File card", "href": reference}}})
	config := f.site.Config
	config.Branding.FooterLinks = []publishing.Link{{Label: "Download", URL: reference}}
	f.site = f.save(t, config)
	f.publish(t)
	page := testenv.Decode[publishing.Page](t, f.env.Call(t, "GET", "/api/v1/public/sites/public-site/pages/guide/start", "", nil, 200))
	f.env.Call(t, "GET", *page.Blocks[0].Content[0].Href, "", nil, 200)
	f.env.Call(t, "GET", page.Blocks[1].Props["href"].(string), "", nil, 200)
	manifest := testenv.Decode[publishing.Snapshot](t, f.env.Call(t, "GET", "/api/v1/public/sites/public-site/manifest", "", nil, 200))
	f.env.Call(t, "GET", manifest.Branding.FooterLinks[0].URL, "", nil, 200)
}

func TestPublishedTableHTMLPagesWithoutJavaScript(t *testing.T) {
	f := newSite(t)
	blockID, fieldID, viewID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	f.write(t, "Static table", []document.Block{{ID: blockID, Type: "data_table"}})
	definition := table.Definition{Title: "Public rows", Fields: []table.Field{{ID: fieldID, Name: "Value", Kind: "text"}}, Views: []table.View{{ID: viewID, Name: "Rows", Kind: "grid"}}, PublicViewID: viewID, PublicFieldIDs: []string{fieldID}}
	created := testenv.Decode[table.Result](t, f.env.Call(t, "POST", f.docPath+"/tables", f.session.AccessToken, table.CreateInput{OperationID: uuid.NewString(), ExpectedDocumentVersion: f.contentVersion, BlockID: blockID, Definition: &definition}, 201))
	upserts := []table.Upsert{}
	for i := range 150 {
		upserts = append(upserts, table.Upsert{ID: uuid.NewString(), Values: map[string]any{fieldID: fmt.Sprintf("Row-%03d <script>", i)}})
	}
	changed := testenv.Decode[table.Result](t, f.env.Call(t, "POST", f.docPath+"/tables/"+created.TableID+"/changes", f.session.AccessToken, table.MutationInput{OperationID: uuid.NewString(), ExpectedDocumentVersion: created.ContentVersion, ExpectedTableVersion: created.TableVersion, Changes: table.Changes{Upserts: upserts}}, 200))
	f.contentVersion = changed.ContentVersion
	f.publish(t)
	page := testenv.Decode[publishing.Page](t, f.env.Call(t, "GET", "/api/v1/public/sites/public-site/pages/guide/start", "", nil, 200))
	ref := page.Blocks[0].DataTable
	if ref == nil {
		t.Fatal("table projection missing")
	}
	target, err := url.Parse(ref.RecordsURL)
	if err != nil {
		t.Fatal(err)
	}
	target.Path = strings.TrimSuffix(target.Path, "/records") + "/html"
	first := f.env.Call(t, "GET", target.String(), "", nil, 200)
	if !strings.Contains(string(first.Body), "Row-000 &lt;script&gt;") || strings.Contains(string(first.Body), "Row-149") || !strings.Contains(string(first.Body), "下一页") || !strings.Contains(string(first.Body), "release_id=") {
		t.Fatal("first static page was unbounded or lacked version-pinned navigation")
	}
	query := target.Query()
	query.Set("page", "2")
	target.RawQuery = query.Encode()
	second := f.env.Call(t, "GET", target.String(), "", nil, 200)
	if !strings.Contains(string(second.Body), "Row-149 &lt;script&gt;") || strings.Contains(string(second.Body), "Row-000") || strings.Contains(string(second.Body), ">下一页</a>") {
		t.Fatal("last static page was incorrect")
	}
	f.env.Call(t, "HEAD", target.String(), "", nil, 200)
	html := f.env.Call(t, "GET", "/s/public-site/guide/start", "", nil, 200)
	if !strings.Contains(string(html.Body), "<noscript>") || !strings.Contains(string(html.Body), "分页阅读完整表格") {
		t.Fatal("reader did not expose static table pagination")
	}
}
