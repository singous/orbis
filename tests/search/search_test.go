//go:build integration

package search_test

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/tests/testenv"
)

type item struct {
	ID, Type, Title, Snippet, Match, Status string
	MatchedCommentID                        *string `json:"matched_comment_id"`
}
type page struct {
	Items      []item
	Pagination struct{ Total int64 }
}
type fixture struct {
	env                       *testenv.Environment
	session                   testenv.Session
	wid, base, cid, did, path string
	contentVersion            int64
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	env := testenv.New(t)
	session, wid := env.Owner(t)
	base := "/api/v1/workspaces/" + wid
	c := testenv.Decode[struct{ ID string }](t, env.Call(
		t,
		"POST",
		base+"/collections",
		session.AccessToken,
		map[string]any{"title": "搜索文集"},
		201,
	))
	d := testenv.Decode[struct{ ID string }](t, env.Call(
		t,
		"POST",
		base+"/collections/"+c.ID+"/documents",
		session.AccessToken,
		map[string]any{"title": "Document"},
		201,
	))
	return fixture{env: env, session: session, wid: wid, base: base, cid: c.ID, did: d.ID, path: base + "/documents/" + d.ID, contentVersion: 1}
}
func (f fixture) query(t *testing.T, text, suffix string) page {
	t.Helper()
	return testenv.Decode[page](t, f.env.Call(
		t,
		"GET",
		f.base+"/search?q="+url.QueryEscape(text)+suffix,
		f.session.AccessToken,
		nil,
		200,
	))
}
func (f *fixture) write(t *testing.T, title string, blocks []document.Block) {
	t.Helper()
	f.env.Call(
		t,
		"PUT",
		f.path+"/content",
		f.session.AccessToken,
		map[string]any{"operation_id": uuid.NewString(), "expected_version": f.contentVersion, "title": title, "blocks": blocks},
		200,
	)
	f.contentVersion++
}
func paragraph(text string) document.Block {
	return document.Block{ID: uuid.NewString(), Type: "paragraph", Content: []document.TextRun{{Text: text}}}
}
func (f fixture) directoryVersion(t *testing.T) int64 {
	t.Helper()
	return testenv.Decode[struct {
		Version int64 `json:"directory_version"`
	}](t, f.env.Call(
		t,
		"GET",
		f.base+"/collections/"+f.cid,
		f.session.AccessToken,
		nil,
		200,
	)).Version
}
func TestSearchCurrentTextCommentsExactIDAndLiteralPatterns(t *testing.T) {
	f := newFixture(t)
	blocks := []document.Block{paragraph("标记 %_\\ 字面文本"), {
		ID:       uuid.NewString(),
		Type:     "card",
		Props:    map[string]any{"title": "组件名称", "href": "https://example.test/hidden-url"},
		Children: []document.Block{paragraph("嵌套正文")},
	}, {ID: uuid.NewString(), Type: "table", Table: &document.Grid{Rows: [][]document.GridCell{{{Content: []document.TextRun{{Text: "表格单元格"}}}}}}}}
	f.write(t, "搜索标题", blocks)
	for _, text := range []string{"%_\\", "组件名称", "嵌套正文", "表格单元格"} {
		found := f.query(t, text, "")
		if len(found.Items) != 1 || found.Items[0].Match != "body" {
			t.Fatalf("missing body %q: %+v", text, found)
		}
	}
	if f.query(t, "hidden-url", "").Pagination.Total != 0 {
		t.Fatal("searched renderer URL metadata")
	}
	comment := testenv.Decode[struct{ ID string }](t, f.env.Call(
		t,
		"POST",
		f.path+"/comments",
		f.session.AccessToken,
		map[string]any{"body": "评论唯一词"},
		201,
	))
	found := f.query(t, "评论唯一词", "")
	if len(found.Items) != 1 || found.Items[0].MatchedCommentID == nil || *found.Items[0].MatchedCommentID != comment.ID {
		t.Fatal("missing comment route")
	}
	exact := f.query(t, "", "&type=document&resource_id="+f.did)
	if exact.Pagination.Total != 1 || exact.Items[0].ID != f.did {
		t.Fatal("exact ID lookup failed")
	}
	empty := f.query(t, "", "")
	if empty.Items == nil || empty.Pagination.Total != 0 {
		t.Fatal("empty search must return []")
	}
	f.write(t, "Changed", []document.Block{paragraph("新内容")})
	if f.query(t, "嵌套正文", "").Pagination.Total != 0 {
		t.Fatal("old block text leaked into current search")
	}
	f.env.Call(
		t,
		"POST",
		f.path+"/restore",
		f.session.AccessToken,
		map[string]any{"operation_id": uuid.NewString(), "expected_version": f.contentVersion, "source_version": 2},
		200,
	)
	if f.query(t, "嵌套正文", "").Pagination.Total != 1 {
		t.Fatal("restored text missing")
	}
	other := f.env.AddUser(t, "outsider@example.test")
	f.env.Call(
		t,
		"GET",
		f.base+"/search?q=搜索",
		other.AccessToken,
		nil,
		404,
	)
	for _, q := range []string{"q=x&q=y", "type=bad", "status=bad", "page_size=101", "resource_id=" + f.did, "q=" + url.QueryEscape(strings.Repeat("字", 241))} {
		f.env.Call(
			t,
			"GET",
			f.base+"/search?"+q,
			f.session.AccessToken,
			nil,
			422,
		)
	}
}
func TestSearchAncestorArchivesAndMetadataOnlyArchives(t *testing.T) {
	f := newFixture(t)
	f.write(t, "父节点", []document.Block{paragraph("归档秘密正文")})
	child := testenv.Decode[struct{ ID string }](t, f.env.Call(
		t,
		"POST",
		f.base+"/collections/"+f.cid+"/documents",
		f.session.AccessToken,
		map[string]any{"title": "子节点", "parent_id": f.did},
		201,
	))
	f.env.Call(
		t,
		"POST",
		f.path+"/comments",
		f.session.AccessToken,
		map[string]any{"body": "归档秘密评论"},
		201,
	)
	f.env.Call(
		t,
		"PUT",
		f.path+"/archive",
		f.session.AccessToken,
		map[string]any{"expected_directory_version": f.directoryVersion(t), "archived": true},
		200,
	)
	for _, text := range []string{"父节点", "子节点", "归档秘密"} {
		if f.query(t, text, "").Pagination.Total != 0 {
			t.Fatalf("active search exposed archive %s", text)
		}
	}
	for _, text := range []string{"子节点", "归档秘密"} {
		if f.query(t, text, "&status=all").Pagination.Total != 0 {
			t.Fatalf("archive search exposed hidden content %s", text)
		}
	}
	archived := f.query(t, "父节点", "&status=archived")
	if archived.Pagination.Total != 1 || archived.Items[0].Match != "title" || archived.Items[0].Status != "archived" {
		t.Fatal("explicit archive metadata missing")
	}
	if f.query(t, "", "&type=document&resource_id="+child.ID+"&status=all").Pagination.Total != 0 {
		t.Fatal("exact lookup bypassed ancestors")
	}
	f.env.Call(
		t,
		"PUT",
		f.path+"/archive",
		f.session.AccessToken,
		map[string]any{"expected_directory_version": f.directoryVersion(t), "archived": false},
		200,
	)
	if f.query(t, "子节点", "").Pagination.Total != 1 {
		t.Fatal("restore visibility missing")
	}
	collection := testenv.Decode[struct {
		GroupID string `json:"group_id"`
	}](t, f.env.Call(
		t,
		"GET",
		f.base+"/collections/"+f.cid,
		f.session.AccessToken,
		nil,
		200,
	))
	group := testenv.Decode[struct{ ID string }](t, f.env.Call(
		t,
		"POST",
		f.base+"/collection-groups",
		f.session.AccessToken,
		map[string]any{"name": "可归档分组"},
		201,
	))
	if collection.GroupID == group.ID {
		t.Fatal("fixture group mismatch")
	}
	f.env.Call(
		t,
		"PATCH",
		f.base+"/collections/"+f.cid,
		f.session.AccessToken,
		map[string]any{"expected_version": 1, "group_id": group.ID},
		200,
	)
	f.env.Call(
		t,
		"PUT",
		f.base+"/collection-groups/"+group.ID+"/archive",
		f.session.AccessToken,
		map[string]any{"expected_version": 1, "archived": true},
		200,
	)
	if f.query(t, "搜索文集", "&status=all").Pagination.Total != 0 || f.query(t, "子节点", "&status=all").Pagination.Total != 0 {
		t.Fatal("inherited group archive leaked")
	}
}
func TestSearchRankingAndStablePagination(t *testing.T) {
	f := newFixture(t)
	for _, title := range []string{"orbis suffix", "prefix orbis", "ORBIS"} {
		f.env.Clock.Advance(time.Millisecond)
		f.env.Call(
			t,
			"POST",
			f.base+"/collections/"+f.cid+"/documents",
			f.session.AccessToken,
			map[string]any{"title": title},
			201,
		)
	}
	expected := []string{"ORBIS", "orbis suffix", "prefix orbis"}
	for i, title := range expected {
		found := f.query(t, "orbis", "&page_size=1&page="+[]string{"1", "2", "3"}[i])
		if found.Pagination.Total != 3 || len(found.Items) != 1 || found.Items[0].Title != title {
			t.Fatalf("page %d: %+v", i, found)
		}
	}
	if got := f.query(t, "orbis", "&page=99"); len(got.Items) != 0 || got.Items == nil || got.Pagination.Total != 3 {
		t.Fatal("past-end page changed total")
	}
}

func TestSearchReadyFilesAcrossMembersAndWorkspaceIsolation(t *testing.T) {
	f := newFixture(t)
	other := f.env.AddUser(t, "files@example.test")
	filename := "附件名称.png"
	for _, entry := range []struct {
		kind, state string
		workspace   *string
	}{
		{"file", "ready", &f.wid}, {"file", "staging", &f.wid}, {"avatar", "ready", nil},
	} {
		id := uuid.NewString()
		if err := f.env.DB.Exec(
			`INSERT INTO assets(id,owner_id,workspace_id,kind,state,storage_key,filename,media_type,size_bytes,sha256,created_at_ms,updated_at_ms)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
			id,
			other.User.ID,
			entry.workspace,
			entry.kind,
			entry.state,
			id+".blob",
			filename,
			"image/png",
			1,
			strings.Repeat("a", 64),
			f.env.Clock.Now().UnixMilli(),
			f.env.Clock.Now().UnixMilli(),
		).Error; err != nil {
			t.Fatal(err)
		}
	}
	found := f.query(t, "附件名称", "&type=file")
	if found.Pagination.Total != 1 || found.Items[0].Match != "title" {
		t.Fatalf("wrong asset state scope: %+v", found)
	}
	found = f.query(t, "image/png", "&type=file")
	if found.Pagination.Total != 1 || found.Items[0].Match != "metadata" {
		t.Fatal("missing asset MIME search")
	}
	if f.query(t, "附件名称", "&type=file&status=archived").Pagination.Total != 0 {
		t.Fatal("files have no archive search state")
	}
	otherWorkspace := testenv.Decode[struct{ ID string }](t, f.env.Call(
		t,
		"POST",
		"/api/v1/workspaces",
		f.session.AccessToken,
		map[string]any{"name": "Other workspace"},
		201,
	))
	result := testenv.Decode[page](t, f.env.Call(
		t,
		"GET",
		"/api/v1/workspaces/"+otherWorkspace.ID+"/search?q="+url.QueryEscape("附件名称"),
		f.session.AccessToken,
		nil,
		200,
	))
	if result.Pagination.Total != 0 {
		t.Fatal("search crossed workspace scope")
	}
}

func TestSearchSiteNamesAndDraftMetadata(t *testing.T) {
	f := newFixture(t)
	created := testenv.Decode[struct{ ID string }](t, f.env.Call(t, "POST", f.base+"/sites", f.session.AccessToken, map[string]any{"name": "版本说明", "slug": "release-notes", "description": "新的知识文档"}, 201))
	for _, text := range []string{"版本说明", "release-", "知识文档"} {
		result := f.query(t, text, "&type=site")
		if result.Pagination.Total != 1 || result.Items[0].ID != created.ID || result.Items[0].Type != "site" {
			t.Fatalf("site search missing %s: %+v", text, result)
		}
	}
	if f.query(t, "版本说明", "&type=site&status=archived").Pagination.Total != 0 {
		t.Fatal("sites do not have archive search state")
	}
}
