//go:build integration

package asset_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"sync"
	"testing"
	"time"

	appstore "orbis.local/orbis/internal/app/postgres"
	"orbis.local/orbis/internal/asset"
	assetstore "orbis.local/orbis/internal/asset/postgres"
	"orbis.local/orbis/internal/platform/storage"
	"orbis.local/orbis/internal/platform/thumbnail"
	"orbis.local/orbis/internal/workspace"
	"orbis.local/orbis/tests/testenv"
)

type blockedStore struct {
	asset.Store
	entered chan struct{}
	release chan struct{}
}

func (s blockedStore) Put(ctx context.Context, key string, reader io.Reader, limit int64) (int64, string, error) {
	close(s.entered)
	select {
	case <-s.release:
	case <-ctx.Done():
		return 0, "", ctx.Err()
	}
	return s.Store.Put(ctx, key, reader, limit)
}
func waitForMemberLock(t *testing.T, env *testenv.Environment) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		if err := env.DB.WithContext(ctx).Raw(
			"SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%workspace_members%FOR UPDATE%')",
		).Scan(&waiting).Error; err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		select {
		case <-ticker.C:
		case <-ctx.Done():
			t.Fatal("role update did not wait for upload")
		}
	}
}
func TestUploadSerializesRoleRevocationAndSurvivesCleanup(t *testing.T) {
	env := testenv.New(t)
	owner, wid := env.Owner(t)
	editor := addMember(t, env, wid, "editor@example.test", "editor")
	local, err := storage.NewLocal(env.StorageDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = local.Close() })
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	var workers sync.WaitGroup
	unblock := func() { once.Do(func() { close(release) }) }
	t.Cleanup(func() { unblock(); workers.Wait() })
	store := blockedStore{Store: local, entered: entered, release: release}
	service := asset.New(
		appstore.NewAssets(env.DB, env.Clock),
		workspace.New(appstore.NewWorkspaces(env.DB), env.Clock),
		store,
		thumbnail.Normalizer{},
		env.Clock,
		1024,
	)
	type uploadOutcome struct {
		row asset.Record
		err error
	}
	uploaded := make(chan uploadOutcome, 1)
	workers.Go(func() {
		row, err := service.Upload(t.Context(), asset.Scope{ActorID: editor.User.ID, WorkspaceID: wid}, "guide.txt", "text/plain", bytes.NewReader([]byte("body")))
		uploaded <- uploadOutcome{row: row, err: err}
	})
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("upload did not start")
	}
	type roleOutcome struct {
		result testenv.Result
		err    error
	}
	changed := make(chan roleOutcome, 1)
	workers.Go(func() {
		result, err := env.Do("PATCH", "/api/v1/workspaces/"+wid+"/members/"+editor.User.ID, owner.AccessToken, map[string]any{"expected_version": 1, "role": "viewer"})
		changed <- roleOutcome{result: result, err: err}
	})
	waitForMemberLock(t, env)
	env.Clock.Advance(asset.Retention + time.Millisecond)
	if cleanup(t, env) != 0 {
		t.Fatal("cleanup purged an upload still holding its lease")
	}
	unblock()
	select {
	case result := <-uploaded:
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.row.State != "ready" {
			t.Fatal("authorized upload did not publish")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("upload did not finish")
	}
	select {
	case result := <-changed:
		requireResult(t, result.result, result.err, 200)
	case <-time.After(5 * time.Second):
		t.Fatal("role change did not finish")
	}
	workers.Wait()
	if _, err := service.Upload(t.Context(), asset.Scope{ActorID: editor.User.ID, WorkspaceID: wid}, "next.txt", "text/plain", bytes.NewReader(nil)); err == nil {
		t.Fatal("revoked editor could upload")
	}
	if cleanup(t, env) != 0 {
		t.Fatal("cleanup removed a published file")
	}
}

func TestFailedFilePublicationAndCleanupRemainRecoverable(t *testing.T) {
	env := testenv.New(t)
	owner, wid := env.Owner(t)
	root := "/api/v1/workspaces/" + wid + "/assets"
	if err := env.DB.Exec("ALTER TABLE assets ADD CONSTRAINT test_reject_ready CHECK (state <> 'ready') NOT VALID").Error; err != nil {
		t.Fatal(err)
	}
	result, err := upload(
		env,
		"POST",
		root,
		owner.AccessToken,
		"guide.txt",
		"text/plain",
		[]byte("stored before failed commit"),
	)
	requireResult(t, result, err, 500)
	if err := env.DB.Exec("ALTER TABLE assets DROP CONSTRAINT test_reject_ready").Error; err != nil {
		t.Fatal(err)
	}
	var row assetstore.Record
	if err := env.DB.Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.State != "staging" {
		t.Fatal("failed publication lost its durable staging record")
	}
	files, err := os.ReadDir(env.StorageDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 {
		t.Fatal("database failure removed bytes before publication state was reconciled")
	}
	env.Clock.Advance(asset.Retention + time.Millisecond)
	failure := errors.New("synthetic storage removal failure")
	if _, err := assetstore.New(env.DB, env.Clock).Cleanup(t.Context(), func(context.Context, string) error { return failure }); !errors.Is(err, failure) {
		t.Fatal("cleanup lost storage failure")
	}
	if err := env.DB.Where("id=?", row.ID).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.State != "abandoned" {
		t.Fatal("abandonment did not commit before deletion")
	}
	if cleanup(t, env) != 1 {
		t.Fatal("cleanup did not recover after storage failure")
	}
	files, err = os.ReadDir(env.StorageDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Fatal("failed object was not removed")
	}
	if cleanup(t, env) != 0 {
		t.Fatal("completed cleanup was not idempotent")
	}
}
