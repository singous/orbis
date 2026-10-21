//go:build integration

package sharing_test

import (
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/sharing"
	"orbis.local/orbis/tests/testenv"
)

type managed struct {
	ID             string
	Version        int64
	Path           *string
	RootDocumentID *string `json:"root_document_id"`
	ExpiresAtMS    *int64  `json:"expires_at_ms"`
	RevokedAtMS    *int64  `json:"revoked_at_ms"`
	UpdatedAtMS    int64   `json:"updated_at_ms"`
}
type created struct {
	Share       managed
	Token, Path string
}
type fixture struct {
	env                                           *testenv.Environment
	session                                       testenv.Session
	wid, cid, root, child, outside, base, docPath string
	share                                         created
}

func newShare(t *testing.T) fixture {
	t.Helper()
	e := testenv.New(t)
	session, wid := e.Owner(t)
	base := "/api/v1/workspaces/" + wid
	c := testenv.Decode[struct{ ID string }](t, e.Call(t, "POST", base+"/collections", session.AccessToken, map[string]any{"title": "Shared collection"}, 201))
	makeDoc := func(title string, parent *string) string {
		return testenv.Decode[struct{ ID string }](t, e.Call(t, "POST", base+"/collections/"+c.ID+"/documents", session.AccessToken, map[string]any{"title": title, "parent_id": parent}, 201)).ID
	}
	root := makeDoc("Share root", nil)
	child := makeDoc("Shared child", &root)
	outside := makeDoc("Not shared", nil)
	result := testenv.Decode[created](t, e.Call(t, "POST", base+"/shares", session.AccessToken, sharing.CreateInput{CollectionID: c.ID, RootDocumentID: &root, AcknowledgePublicScope: true}, 201))
	return fixture{env: e, session: session, wid: wid, cid: c.ID, root: root, child: child, outside: outside, base: base, docPath: base + "/documents/" + child, share: result}
}
func (f fixture) public() string { return "/api/v1/public/shares/" + f.share.Token }
func (f fixture) version(t *testing.T) int64 {
	t.Helper()
	return testenv.Decode[struct {
		Version int64 `json:"directory_version"`
	}](t, f.env.Call(t, "GET", f.base+"/collections/"+f.cid, f.session.AccessToken, nil, 200)).Version
}
func (f fixture) write(t *testing.T, expected int64, blocks []document.Block) {
	t.Helper()
	f.env.Call(t, "PUT", f.docPath+"/content", f.session.AccessToken, map[string]any{"operation_id": uuid.NewString(), "expected_version": expected, "title": "Shared child", "blocks": blocks}, 200)
}
func paragraph(text string) document.Block {
	return document.Block{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: text}}}
}
func TestLiveShareDirectoryScopeAndCurrentContent(t *testing.T) {
	f := newShare(t)
	if len(f.share.Token) != 43 || f.share.Share.Path == nil || f.share.Share.Version != 1 {
		t.Fatal("invalid share capability")
	}
	directory := testenv.Decode[struct {
		Items            []sharing.Node
		RootDocumentID   *string `json:"root_document_id"`
		DirectoryVersion int64   `json:"directory_version"`
	}](t, f.env.Call(t, "GET", f.public()+"/directory", "", nil, 200))
	if len(directory.Items) != 1 || directory.Items[0].ID != f.root || directory.Items[0].ParentID != nil {
		t.Fatal("subtree directory exposed siblings or a private parent")
	}
	children := testenv.Decode[struct{ Items []sharing.Node }](t, f.env.Call(t, "GET", f.public()+"/directory?parent_id="+f.root, "", nil, 200))
	if len(children.Items) != 1 || children.Items[0].ID != f.child {
		t.Fatal("missing shared child")
	}
	f.env.Call(t, "GET", f.public()+"/documents/"+f.outside+"/content", "", nil, 404)
	href := "/documents/" + f.outside
	f.write(t, 1, []document.Block{{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: "Visible label", Href: &href}}}})
	content := testenv.Decode[struct {
		Document sharing.Document
		Blocks   []struct{ Content []document.TextRun }
	}](t, f.env.Call(t, "GET", f.public()+"/documents/"+f.child+"/content", "", nil, 200))
	if content.Document.ContentVersion != 2 || content.Blocks[0].Content[0].Href != nil || content.Blocks[0].Content[0].Text != "Visible label" {
		t.Fatal("live projection lost text or disclosed out-of-scope navigation")
	}
	f.write(t, 2, []document.Block{paragraph("Live update")})
	f.env.Call(t, "GET", f.public()+"/documents/"+f.child+"/content?version=2", "", nil, 409)
	latest := f.env.Call(t, "GET", f.public()+"/documents/"+f.child+"/content", "", nil, 200)
	if !strings.Contains(string(latest.Data), "Live update") {
		t.Fatal("share followed a stale snapshot")
	}
	f.env.Call(t, "PATCH", f.docPath+"/location", f.session.AccessToken, map[string]any{"expected_directory_version": f.version(t), "parent_id": nil}, 200)
	f.env.Call(t, "GET", f.public()+"/documents/"+f.child, "", nil, 404)
	f.env.Call(t, "GET", f.public()+"/directory?directory_version="+versionString(directory.DirectoryVersion), "", nil, 409)
	f.env.Call(t, "PATCH", f.docPath+"/location", f.session.AccessToken, map[string]any{"expected_directory_version": f.version(t), "parent_id": f.root}, 200)
	f.env.Call(t, "GET", f.public()+"/documents/"+f.child, "", nil, 200)
}
func TestLiveShareCursorsBindGrantAndRejectStaleVersions(t *testing.T) {
	f := newShare(t)
	f.write(t, 1, []document.Block{paragraph("one"), paragraph("two"), paragraph("three")})
	path := f.public() + "/documents/" + f.child + "/blocks?page_size=1"
	first := testenv.Decode[struct {
		Document   sharing.Document
		Items      []sharing.Block
		Pagination struct {
			Next *string `json:"next_cursor"`
			More bool    `json:"has_more"`
		}
	}](t, f.env.Call(t, "GET", path, "", nil, 200))
	if len(first.Items) != 1 || first.Pagination.Next == nil || !first.Pagination.More {
		t.Fatal("missing share cursor")
	}
	other := testenv.Decode[created](t, f.env.Call(t, "POST", f.base+"/shares", f.session.AccessToken, sharing.CreateInput{CollectionID: f.cid, RootDocumentID: &f.root, AcknowledgePublicScope: true}, 201))
	f.env.Call(t, "GET", "/api/v1/public/shares/"+other.Token+"/documents/"+f.child+"/blocks?cursor="+url.QueryEscape(*first.Pagination.Next), "", nil, 422)
	second := f.env.Call(t, "GET", path+"&cursor="+url.QueryEscape(*first.Pagination.Next), "", nil, 200)
	if strings.Contains(string(second.Data), first.Items[0].ID) {
		t.Fatal("cursor repeated a block")
	}
	f.env.Call(t, "GET", f.public()+"/documents/"+f.child+"/blocks/"+first.Items[0].ID+"?version=2", "", nil, 200)
	f.write(t, 2, []document.Block{paragraph("changed")})
	f.env.Call(t, "GET", path+"&cursor="+url.QueryEscape(*first.Pagination.Next), "", nil, 409)
	f.env.Call(t, "GET", f.public()+"/documents/"+f.child+"/blocks?page_size=101", "", nil, 422)
}
func TestLiveShareRevokeExpiryAndManagerPermissions(t *testing.T) {
	f := newShare(t)
	viewer := f.env.AddUser(t, "viewer@example.test")
	now := f.env.Clock.Now().UnixMilli()
	if err := f.env.DB.Exec("INSERT INTO workspace_members(workspace_id,user_id,role,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?)", f.wid, viewer.User.ID, "viewer", now, now).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "GET", f.base+"/shares", viewer.AccessToken, nil, 403)
	f.env.Call(t, "POST", f.base+"/shares", viewer.AccessToken, sharing.CreateInput{CollectionID: f.cid, AcknowledgePublicScope: true}, 403)
	f.env.Call(t, "POST", f.base+"/shares", f.session.AccessToken, sharing.CreateInput{CollectionID: f.cid}, 422)
	expires := now + 1000
	expiring := testenv.Decode[created](t, f.env.Call(t, "POST", f.base+"/shares", f.session.AccessToken, sharing.CreateInput{CollectionID: f.cid, AcknowledgePublicScope: true, ExpiresAtMS: &expires}, 201))
	f.env.Call(t, "GET", "/api/v1/public/shares/"+expiring.Token+"/directory", "", nil, 200)
	f.env.Clock.Advance(time.Second)
	f.env.Call(t, "GET", "/api/v1/public/shares/"+expiring.Token+"/directory", "", nil, 404)
	listed := testenv.Decode[struct{ Items []managed }](t, f.env.Call(t, "GET", f.base+"/shares?collection_id="+f.cid, f.session.AccessToken, nil, 200))
	for _, item := range listed.Items {
		if item.ID == f.share.Share.ID && (item.Path == nil || *item.Path != f.share.Path) {
			t.Fatal("active share URL could not be recovered")
		}
		if item.ID == expiring.Share.ID && item.Path != nil {
			t.Fatal("expired URL was recovered")
		}
	}
	path := f.base + "/shares/" + f.share.Share.ID + "/revoke"
	f.env.Call(t, "POST", path, f.session.AccessToken, map[string]any{"expected_version": 99}, 409)
	first := testenv.Decode[managed](t, f.env.Call(t, "POST", path, f.session.AccessToken, map[string]any{"expected_version": 1}, 200))
	f.env.Clock.Advance(time.Second)
	repeated := testenv.Decode[managed](t, f.env.Call(t, "POST", path, f.session.AccessToken, map[string]any{"expected_version": 1}, 200))
	if first.RevokedAtMS == nil || repeated.RevokedAtMS == nil || *first.RevokedAtMS != *repeated.RevokedAtMS || first.Version != 2 || repeated.UpdatedAtMS != first.UpdatedAtMS {
		t.Fatal("repeated revoke changed the original receipt")
	}
	f.env.Call(t, "GET", f.public()+"/directory", "", nil, 404)
	f.env.Call(t, "GET", f.public()+"/documents/"+f.child, "", nil, 404)
}
func TestLiveShareArchivesDoNotAuthorizeHiddenHistory(t *testing.T) {
	f := newShare(t)
	f.write(t, 1, []document.Block{paragraph("Secret when archived")})
	f.env.Call(t, "PUT", f.base+"/documents/"+f.root+"/archive", f.session.AccessToken, map[string]any{"expected_directory_version": f.version(t), "archived": true}, 200)
	f.env.Call(t, "GET", f.public()+"/directory", "", nil, 404)
	f.env.Call(t, "GET", f.public()+"/documents/"+f.child+"/content?version=2", "", nil, 404)
	f.env.Call(t, "PUT", f.base+"/documents/"+f.root+"/archive", f.session.AccessToken, map[string]any{"expected_directory_version": f.version(t), "archived": false}, 200)
	f.env.Call(t, "GET", f.public()+"/documents/"+f.child+"/content", "", nil, 200)
	f.env.Call(t, "PUT", f.base+"/collections/"+f.cid+"/archive", f.session.AccessToken, map[string]any{"expected_directory_version": f.version(t), "archived": true}, 200)
	f.env.Call(t, "GET", f.public()+"/directory", "", nil, 404)
	f.env.Call(t, "POST", f.base+"/shares/"+f.share.Share.ID+"/revoke", f.session.AccessToken, map[string]any{"expected_version": 1}, 200)
}

func versionString(value int64) string { return strconv.FormatInt(value, 10) }

func TestSharedSiblingWindowsBindParentVersionScopeAndDeferPayloads(t *testing.T) {
	f := newShare(t)
	group, small, large := uuid.NewString(), paragraph("nested small"), paragraph(strings.Repeat("large ", 30000))
	other := paragraph("root sibling")
	f.write(t, 1, []document.Block{{ID: group, Type: "group", Children: []document.Block{small, large}}, other})
	type window struct {
		Document   sharing.Document
		Items      []sharing.ChildBlock
		Pagination struct {
			Next *string `json:"next_cursor"`
			More bool    `json:"has_more"`
		}
	}
	base := f.public() + "/documents/" + f.child
	roots := testenv.Decode[window](t, f.env.Call(t, "GET", base+"/children?page_size=1", "", nil, 200))
	if len(roots.Items) != 1 || roots.Items[0].ID != group || roots.Items[0].ChildCount != 2 || roots.Pagination.Next == nil || !roots.Items[0].PayloadLoaded {
		t.Fatal("shared sibling metadata or order was lost")
	}
	nested := testenv.Decode[window](t, f.env.Call(t, "GET", base+"/children?version=2&parent_id="+group, "", nil, 200))
	if len(nested.Items) != 2 || nested.Items[0].ID != small.ID || nested.Items[1].PayloadLoaded || nested.Items[1].Block != nil || nested.Items[1].PayloadBytes <= sharing.MaxWindowPayloadBytes {
		t.Fatal("public payload budget did not preserve metadata and omit large bodies")
	}
	f.env.Call(t, "GET", base+"/blocks/"+large.ID+"?version=2", "", nil, 200)
	f.env.Call(t, "GET", base+"/children?parent_id="+group+"&cursor="+url.QueryEscape(*roots.Pagination.Next), "", nil, 422)
	f.env.Call(t, "GET", base+"/blocks?cursor="+url.QueryEscape(*roots.Pagination.Next), "", nil, 422)
	next := testenv.Decode[window](t, f.env.Call(t, "GET", base+"/children?cursor="+url.QueryEscape(*roots.Pagination.Next), "", nil, 200))
	if len(next.Items) != 1 || next.Items[0].ID != other.ID {
		t.Fatal("shared sibling cursor did not retain position order")
	}
	f.env.Call(t, "GET", f.public()+"/documents/"+f.outside+"/children", "", nil, 404)
	f.write(t, 2, []document.Block{paragraph("changed")})
	f.env.Call(t, "GET", base+"/children?cursor="+url.QueryEscape(*roots.Pagination.Next), "", nil, 409)
}
