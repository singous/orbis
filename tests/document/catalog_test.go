//go:build integration

package document_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"orbis.local/orbis/tests/testenv"
)

type group struct {
	ID, Name     string
	IsDefault    bool   `json:"is_default"`
	SortOrder    int    `json:"sort_order"`
	Version      int64  `json:"version"`
	ArchivedAtMS *int64 `json:"archived_at_ms"`
}
type collectionInfo struct {
	ID, Title        string
	GroupID          string `json:"group_id"`
	SortOrder        int    `json:"sort_order"`
	MetadataVersion  int64  `json:"metadata_version"`
	DirectoryVersion int64  `json:"directory_version"`
	ArchivedAtMS     *int64 `json:"archived_at_ms"`
}

func groupPath(f fixture) string { return "/api/v1/workspaces/" + f.workspaceID + "/collection-groups" }
func createGroup(t *testing.T, f fixture, name string) group {
	t.Helper()
	return testenv.Decode[group](t, f.env.Call(
		t,
		"POST",
		groupPath(f),
		f.session.AccessToken,
		map[string]any{"name": name, "sort_order": 5},
		201,
	))
}
func collectionInfoFor(t *testing.T, f fixture) collectionInfo {
	t.Helper()
	return testenv.Decode[collectionInfo](t, f.env.Call(
		t,
		"GET",
		collectionPath(f),
		f.session.AccessToken,
		nil,
		200,
	))
}
func moveCollection(t *testing.T, f fixture, gid any, version int64, status int) collectionInfo {
	t.Helper()
	return testenv.Decode[collectionInfo](t, f.env.Call(
		t,
		"PATCH",
		collectionPath(f),
		f.session.AccessToken,
		map[string]any{"expected_version": version, "group_id": gid},
		status,
	))
}
func archiveGroup(t *testing.T, f fixture, g group, archived bool, status int) group {
	t.Helper()
	return testenv.Decode[group](t, f.env.Call(
		t,
		"PUT",
		groupPath(f)+"/"+g.ID+"/archive",
		f.session.AccessToken,
		map[string]any{"expected_version": g.Version, "archived": archived},
		status,
	))
}

func TestCollectionGroupsMetadataAndDefault(t *testing.T) {
	f := newDocument(t)
	env := f.env
	token := f.session.AccessToken
	initial := testenv.Decode[struct{ Items []group }](t, env.Call(
		t,
		"GET",
		groupPath(f),
		token,
		nil,
		200,
	))
	if len(initial.Items) != 1 || !initial.Items[0].IsDefault {
		t.Fatal("workspace must have one default group")
	}
	original := collectionInfoFor(t, f)
	if original.GroupID != initial.Items[0].ID || original.MetadataVersion != 1 {
		t.Fatal("collection did not use the default group")
	}
	archiveGroup(t, f, initial.Items[0], true, 409)
	custom := createGroup(t, f, "  工作笔记  ")
	if custom.Name != "工作笔记" || custom.IsDefault || custom.Version != 1 {
		t.Fatal("new group metadata is incorrect")
	}
	updated := testenv.Decode[group](t, env.Call(
		t,
		"PATCH",
		groupPath(f)+"/"+custom.ID,
		token,
		map[string]any{"expected_version": 1, "name": "项目", "sort_order": 0},
		200,
	))
	if updated.SortOrder != 0 || updated.Name != "项目" || updated.Version != 2 {
		t.Fatal("zero sort order was ignored")
	}
	moved := moveCollection(t, f, custom.ID, 1, 200)
	if moved.GroupID != custom.ID || moved.DirectoryVersion != original.DirectoryVersion || moved.MetadataVersion != 2 {
		t.Fatal("metadata change modified directory version")
	}
	titled := testenv.Decode[collectionInfo](t, env.Call(
		t,
		"PATCH",
		collectionPath(f),
		token,
		map[string]any{"expected_version": 2, "title": "  新文集  ", "sort_order": 9},
		200,
	))
	if titled.GroupID != custom.ID || titled.Title != "新文集" || titled.SortOrder != 9 {
		t.Fatal("omitted group was changed")
	}
	second := testenv.Decode[collectionInfo](t, env.Call(
		t,
		"POST",
		"/api/v1/workspaces/"+f.workspaceID+"/collections",
		token,
		map[string]any{"title": "Second", "group_id": custom.ID, "sort_order": 0},
		201,
	))
	page := testenv.Decode[struct {
		Items      []collectionInfo
		Pagination struct{ Total int64 }
	}](t, env.Call(
		t,
		"GET",
		"/api/v1/workspaces/"+f.workspaceID+"/collections?group_id="+custom.ID+"&page_size=1",
		token,
		nil,
		200,
	))
	if len(page.Items) != 1 || page.Items[0].ID != second.ID || page.Pagination.Total != 2 {
		t.Fatal("group filtering and ordering failed")
	}
	returned := moveCollection(t, f, nil, 3, 200)
	if returned.GroupID != original.GroupID {
		t.Fatal("null group did not return to default")
	}
	for _, body := range []map[string]any{
		{"expected_version": 4},
		{"expected_version": 4, "title": nil},
		{"expected_version": 4, "sort_order": nil},
		{"expected_version": 4, "sort_order": -1},
		{"expected_version": 4, "group_id": "invalid"},
	} {
		env.Call(
			t,
			"PATCH",
			collectionPath(f),
			token,
			body,
			422,
		)
	}
	env.Call(
		t,
		"PATCH",
		groupPath(f)+"/"+custom.ID,
		token,
		map[string]any{"expected_version": 2, "name": nil},
		422,
	)
	env.Call(
		t,
		"GET",
		groupPath(f)+"?page_size=101",
		token,
		nil,
		422,
	)
	env.Call(
		t,
		"POST",
		groupPath(f),
		token,
		map[string]any{"name": "a\x00b"},
		422,
	)
	env.Call(
		t,
		"GET",
		"/api/v1/workspaces/"+f.workspaceID+"/collections?group_id=bad",
		token,
		nil,
		422,
	)
	viewer := documentMember(t, f, "viewer@example.test", "viewer")
	env.Call(
		t,
		"GET",
		groupPath(f),
		viewer.AccessToken,
		nil,
		200,
	)
	env.Call(
		t,
		"POST",
		groupPath(f),
		viewer.AccessToken,
		map[string]any{"name": "forbidden"},
		403,
	)
	env.Call(
		t,
		"PATCH",
		collectionPath(f),
		viewer.AccessToken,
		map[string]any{"expected_version": 4, "title": "forbidden"},
		403,
	)
	otherWorkspace := testenv.Decode[struct{ ID string }](t, env.Call(
		t,
		"POST",
		"/api/v1/workspaces",
		token,
		map[string]any{"name": "Other"},
		201,
	))
	otherGroups := testenv.Decode[struct{ Items []group }](t, env.Call(
		t,
		"GET",
		"/api/v1/workspaces/"+otherWorkspace.ID+"/collection-groups",
		token,
		nil,
		200,
	))
	if len(otherGroups.Items) != 1 || !otherGroups.Items[0].IsDefault {
		t.Fatal("ordinary workspace creation omitted default group")
	}
	moveCollection(t, f, otherGroups.Items[0].ID, 4, 404)
	env.Call(
		t,
		"POST",
		"/api/v1/workspaces/"+f.workspaceID+"/collections",
		token,
		map[string]any{"title": "wrong scope", "group_id": otherGroups.Items[0].ID},
		404,
	)
}

func TestGroupArchiveVisibilityAndRestoration(t *testing.T) {
	f := newDocument(t)
	env := f.env
	token := f.session.AccessToken
	custom := createGroup(t, f, "Project")
	moveCollection(t, f, custom.ID, 1, 200)
	child := createNode(t, f, "Archived child", nil)
	archiveNode(t, f, child.ID, true, 200)
	env.Call(
		t,
		"POST",
		f.path+"/comments",
		token,
		map[string]any{"body": "retained discussion"},
		201,
	)
	custom = archiveGroup(t, f, custom, true, 200)
	if custom.ArchivedAtMS == nil {
		t.Fatal("group archive has no timestamp")
	}
	for _, suffix := range []string{"", "/content?version=1", "/revisions", "/blocks", "/comments"} {
		env.Call(
			t,
			"GET",
			f.path+suffix,
			token,
			nil,
			404,
		)
	}
	env.Call(
		t,
		"GET",
		collectionPath(f)+"/children",
		token,
		nil,
		404,
	)
	env.Call(
		t,
		"POST",
		f.path+"/comments",
		token,
		map[string]any{"body": "hidden"},
		404,
	)
	env.Call(
		t,
		"POST",
		collectionPath(f)+"/documents",
		token,
		map[string]any{"title": "hidden"},
		404,
	)
	env.Call(
		t,
		"POST",
		"/api/v1/workspaces/"+f.workspaceID+"/collections",
		token,
		map[string]any{"title": "hidden", "group_id": custom.ID},
		404,
	)
	archiveNode(t, f, child.ID, false, 409)
	env.Call(
		t,
		"PUT",
		collectionPath(f)+"/archive",
		token,
		map[string]any{"expected_directory_version": directoryVersion(t, f), "archived": true},
		200,
	)
	env.Call(
		t,
		"PUT",
		collectionPath(f)+"/archive",
		token,
		map[string]any{"expected_directory_version": directoryVersion(t, f), "archived": false},
		409,
	)
	hidden := testenv.Decode[struct{ Items []collectionInfo }](t, env.Call(
		t,
		"GET",
		"/api/v1/workspaces/"+f.workspaceID+"/collections",
		token,
		nil,
		200,
	))
	if len(hidden.Items) != 0 {
		t.Fatal("archived group leaked into active collections")
	}
	archived := testenv.Decode[struct{ Items []group }](t, env.Call(
		t,
		"GET",
		groupPath(f)+"?archived=true",
		token,
		nil,
		200,
	))
	if len(archived.Items) != 1 || archived.Items[0].ID != custom.ID {
		t.Fatal("archived groups listing failed")
	}
	custom = archiveGroup(t, f, custom, false, 200)
	if custom.ArchivedAtMS != nil {
		t.Fatal("group restore did not clear timestamp")
	}
	env.Call(
		t,
		"GET",
		f.path,
		token,
		nil,
		404,
	)
	env.Call(
		t,
		"PUT",
		collectionPath(f)+"/archive",
		token,
		map[string]any{"expected_directory_version": directoryVersion(t, f), "archived": false},
		200,
	)
	env.Call(
		t,
		"GET",
		f.path,
		token,
		nil,
		200,
	)
	env.Call(
		t,
		"GET",
		nodePath(f, child.ID),
		token,
		nil,
		404,
	)
	page := testenv.Decode[struct{ Items []comment }](t, env.Call(
		t,
		"GET",
		f.path+"/comments",
		token,
		nil,
		200,
	))
	if len(page.Items) != 1 || page.Items[0].Body != "retained discussion" {
		t.Fatal("group archive lost comments")
	}
}

func TestConcurrentCatalogUpdates(t *testing.T) {
	f := newDocument(t)
	g := createGroup(t, f, "Project")
	for _, test := range []struct{ name, path, field, code string }{
		{"group", groupPath(f) + "/" + g.ID, "name", "GROUP_VERSION_CONFLICT"},
		{"collection", collectionPath(f), "title", "COLLECTION_VERSION_CONFLICT"},
	} {
		t.Run(test.name, func(t *testing.T) {
			type outcome struct {
				result testenv.Result
				err    error
			}
			results := make(chan outcome, 2)
			var workers sync.WaitGroup
			for _, value := range []string{"first", "second"} {
				workers.Go(func() {
					result, err := f.env.Do("PATCH", test.path, f.session.AccessToken, map[string]any{"expected_version": 1, test.field: value})
					results <- outcome{result: result, err: err}
				})
			}
			workers.Wait()
			close(results)
			statuses := map[int]int{}
			for result := range results {
				if result.err != nil {
					t.Fatal(result.err)
				}
				statuses[result.result.Status]++
				if result.result.Status == 409 && result.result.Code != test.code {
					t.Fatal("wrong conflict code")
				}
			}
			if statuses[200] != 1 || statuses[409] != 1 {
				t.Fatalf("concurrent catalog updates: %v", statuses)
			}
		})
	}
}

func waitForDocumentLock(t *testing.T, env *testenv.Environment, pattern string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		if err := env.DB.WithContext(ctx).Raw("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE ?)", pattern).Scan(&waiting).Error; err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		select {
		case <-ticker.C:
		case <-ctx.Done():
			t.Fatal("request did not reach the expected lock")
		}
	}
}

func TestGroupArchiveWaitsForCommentAndThenHidesIt(t *testing.T) {
	f := newDocument(t)
	g := createGroup(t, f, "Project")
	moveCollection(t, f, g.ID, 1, 200)
	row := testenv.Decode[comment](t, f.env.Call(
		t,
		"POST",
		f.path+"/comments",
		f.session.AccessToken,
		map[string]any{"body": "original"},
		201,
	))
	pool, err := f.env.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	blocker, err := pool.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = blocker.Rollback() })
	if _, err := blocker.ExecContext(t.Context(), "SELECT id FROM document_comments WHERE id=$1 FOR NO KEY UPDATE", row.ID); err != nil {
		t.Fatal(err)
	}
	type outcome struct {
		result testenv.Result
		err    error
	}
	written := make(chan outcome, 1)
	archived := make(chan outcome, 1)
	go func() {
		result, err := f.env.Do("PATCH", f.path+"/comments/"+row.ID, f.session.AccessToken, map[string]any{"expected_version": 1, "body": "committed before archive"})
		written <- outcome{result: result, err: err}
	}()
	waitForDocumentLock(t, f.env, "%document_comments%FOR NO KEY UPDATE%")
	go func() {
		result, err := f.env.Do("PUT", groupPath(f)+"/"+g.ID+"/archive", f.session.AccessToken, map[string]any{"expected_version": 1, "archived": true})
		archived <- outcome{result: result, err: err}
	}()
	waitForDocumentLock(t, f.env, "%collection_groups%FOR NO KEY UPDATE%")
	if err := blocker.Commit(); err != nil {
		t.Fatal(err)
	}
	for _, ch := range []chan outcome{written, archived} {
		select {
		case result := <-ch:
			if result.err != nil {
				t.Fatal(result.err)
			}
			if result.result.Status != 200 {
				t.Fatalf("serialized request failed: %+v", result.result)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("serialized request did not finish")
		}
	}
	f.env.Call(
		t,
		"GET",
		f.path+"/comments",
		f.session.AccessToken,
		nil,
		404,
	)
	g.Version = 2
	archiveGroup(t, f, g, false, 200)
	page := testenv.Decode[struct{ Items []comment }](t, f.env.Call(
		t,
		"GET",
		f.path+"/comments",
		f.session.AccessToken,
		nil,
		200,
	))
	if len(page.Items) != 1 || page.Items[0].Body != "committed before archive" {
		t.Fatal("archive raced past an authorized comment update")
	}
}
