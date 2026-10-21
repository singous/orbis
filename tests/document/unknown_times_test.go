//go:build integration

package document_test

import (
	"orbis.local/orbis/tests/testenv"
	"testing"
)

type archiveMetadata struct {
	ID           string
	IsArchived   bool   `json:"is_archived"`
	ArchivedAtMS *int64 `json:"archived_at_ms"`
}

func TestUnknownHistoricalArchiveTimeRetainsVisibilityAndRestores(t *testing.T) {
	f := newDocument(t)
	child := createNode(t, f, "Hidden child", &f.documentID)
	if err := f.env.DB.Table("documents").Where("id=?", f.documentID).Updates(map[string]any{"is_archived": true, "archived_at_ms": nil}).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 404)
	f.env.Call(t, "GET", nodePath(f, child.ID)+"/content", f.session.AccessToken, nil, 404)
	f.env.Call(t, "GET", f.path+"/comments", f.session.AccessToken, nil, 404)
	archived := testenv.Decode[struct{ Items []archiveMetadata }](t, f.env.Call(t, "GET", "/api/v1/workspaces/"+f.workspaceID+"/documents/archive", f.session.AccessToken, nil, 200))
	if len(archived.Items) != 1 || !archived.Items[0].IsArchived || archived.Items[0].ArchivedAtMS != nil {
		t.Fatal("unknown event time changed the explicit archive state")
	}
	query := "/api/v1/workspaces/" + f.workspaceID + "/search?type=document&status=archived&resource_id=" + f.documentID
	matches := testenv.Decode[struct{ Items []struct{ ID, Status string } }](t, f.env.Call(t, "GET", query, f.session.AccessToken, nil, 200))
	if len(matches.Items) != 1 || matches.Items[0].Status != "archived" {
		t.Fatal("archive search relied on a timestamp instead of state")
	}
	archiveNode(t, f, f.documentID, false, 200)
	f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200)
	f.env.Call(t, "GET", nodePath(f, child.ID)+"/content", f.session.AccessToken, nil, 200)
	archiveNode(t, f, f.documentID, true, 200)
	known := testenv.Decode[struct{ Items []archiveMetadata }](t, f.env.Call(t, "GET", "/api/v1/workspaces/"+f.workspaceID+"/documents/archive", f.session.AccessToken, nil, 200))
	if len(known.Items) != 1 || !known.Items[0].IsArchived || known.Items[0].ArchivedAtMS == nil {
		t.Fatal("new archive action did not record its actual event time")
	}
}
func TestUnknownHistoricalCollectionArchiveTimeRetainsCatalogState(t *testing.T) {
	f := newDocument(t)
	if err := f.env.DB.Table("collections").Where("id=?", f.collectionID).Updates(map[string]any{"is_archived": true, "archived_at_ms": nil}).Error; err != nil {
		t.Fatal(err)
	}
	f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 404)
	root := "/api/v1/workspaces/" + f.workspaceID + "/collections"
	archived := testenv.Decode[struct{ Items []archiveMetadata }](t, f.env.Call(t, "GET", root+"?archived=true", f.session.AccessToken, nil, 200))
	if len(archived.Items) != 1 || !archived.Items[0].IsArchived || archived.Items[0].ArchivedAtMS != nil {
		t.Fatal("collection archive metadata was lost")
	}
	f.env.Call(t, "PUT", collectionPath(f)+"/archive", f.session.AccessToken, map[string]any{"archived": false, "expected_directory_version": directoryVersion(t, f)}, 200)
	f.env.Call(t, "GET", f.path+"/content", f.session.AccessToken, nil, 200)
}
func TestUnknownHistoricalResolutionTimeRemainsNullable(t *testing.T) {
	f := newDocument(t)
	path := f.path + "/comments"
	initial := testenv.Decode[comment](t, f.env.Call(t, "POST", path, f.session.AccessToken, map[string]any{"body": "Resolved legacy comment"}, 201))
	if err := f.env.DB.Table("document_comments").Where("id=?", initial.ID).Updates(map[string]any{"is_resolved": true, "resolved_at_ms": nil}).Error; err != nil {
		t.Fatal(err)
	}
	items := testenv.Decode[struct{ Items []comment }](t, f.env.Call(t, "GET", path, f.session.AccessToken, nil, 200))
	if len(items.Items) != 1 || !items.Items[0].IsResolved || items.Items[0].ResolvedAtMS != nil {
		t.Fatal("unknown resolution time was invented or state was lost")
	}
	f.env.Call(t, "PATCH", path+"/"+initial.ID, f.session.AccessToken, map[string]any{"expected_version": 1, "is_resolved": false}, 200)
	solved := testenv.Decode[comment](t, f.env.Call(t, "PATCH", path+"/"+initial.ID, f.session.AccessToken, map[string]any{"expected_version": 2, "is_resolved": true}, 200))
	if !solved.IsResolved || solved.ResolvedAtMS == nil {
		t.Fatal("new resolution did not record its actual time")
	}
}
