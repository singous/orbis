//go:build integration

package asset_test

import (
	"bytes"
	"image/png"
	"os"
	"sync"
	"testing"
	"time"

	"orbis.local/orbis/tests/testenv"
)

type avatarUser struct {
	AvatarAssetID *string `json:"avatar_asset_id"`
	Version       int64   `json:"profile_version"`
}

func TestAvatarLifecycleAndPrivacy(t *testing.T) {
	env := testenv.New(t)
	owner, wid := env.Owner(t)
	data := imageBytes(t)
	result, err := upload(
		env,
		"PUT",
		"/api/v1/me/avatar?expected_version=1",
		owner.AccessToken,
		"photo.png",
		"image/png",
		data,
	)
	first := testenv.Decode[avatarUser](t, requireResult(t, result, err, 200))
	if first.AvatarAssetID == nil || first.Version != 2 {
		t.Fatal("avatar publication did not advance profile version")
	}
	read := download(
		t,
		env,
		"GET",
		"/api/v1/me/avatar",
		owner.AccessToken,
		nil,
		200,
	)
	cfg, err := png.DecodeConfig(bytes.NewReader(read.Body))
	if err != nil || cfg.Width != 256 || cfg.Height != 256 {
		t.Fatalf("avatar dimensions: %+v %v", cfg, err)
	}
	if read.Header.Get("Content-Type") != "image/png" {
		t.Fatal("avatar was not re-encoded to PNG")
	}
	download(
		t,
		env,
		"HEAD",
		"/api/v1/me/avatar",
		owner.AccessToken,
		nil,
		200,
	)
	current := testenv.Decode[avatarUser](t, env.Call(
		t,
		"GET",
		"/api/v1/me",
		owner.AccessToken,
		nil,
		200,
	))
	if current.AvatarAssetID == nil || *current.AvatarAssetID != *first.AvatarAssetID {
		t.Fatal("avatar pointer was not persisted")
	}
	download(
		t,
		env,
		"GET",
		"/api/v1/workspaces/"+wid+"/assets/"+*first.AvatarAssetID+"/content",
		owner.AccessToken,
		nil,
		404,
	)
	other := env.AddUser(t, "other@example.test")
	download(
		t,
		env,
		"GET",
		"/api/v1/me/avatar",
		other.AccessToken,
		nil,
		404,
	)
	result, err = upload(
		env,
		"PUT",
		"/api/v1/me/avatar?expected_version=2",
		owner.AccessToken,
		"bad.png",
		"image/png",
		[]byte("not an image"),
	)
	requireResult(t, result, err, 422)
	result, err = upload(
		env,
		"PUT",
		"/api/v1/me/avatar?expected_version=2",
		owner.AccessToken,
		"huge.png",
		"image/png",
		bytes.Repeat([]byte("x"), (2<<20)+1),
	)
	requireResult(t, result, err, 413)
	result, err = upload(
		env,
		"PUT",
		"/api/v1/me/avatar?expected_version=1",
		owner.AccessToken,
		"stale.png",
		"image/png",
		data,
	)
	requireResult(t, result, err, 409)
	result, err = upload(
		env,
		"PUT",
		"/api/v1/me/avatar?expected_version=2",
		owner.AccessToken,
		"next.png",
		"image/png",
		data,
	)
	second := testenv.Decode[avatarUser](t, requireResult(t, result, err, 200))
	if second.AvatarAssetID == nil || *second.AvatarAssetID == *first.AvatarAssetID || second.Version != 3 {
		t.Fatal("avatar replacement did not use a fresh object")
	}
	var oldState string
	if err := env.DB.Table("assets").Select("state").Where("id=?", *first.AvatarAssetID).Scan(&oldState).Error; err != nil {
		t.Fatal(err)
	}
	if oldState != "obsolete" {
		t.Fatal("previous avatar was not retired")
	}
	cleared := testenv.Decode[avatarUser](t, env.Call(
		t,
		"DELETE",
		"/api/v1/me/avatar",
		owner.AccessToken,
		map[string]any{"expected_version": 3},
		200,
	))
	if cleared.AvatarAssetID != nil || cleared.Version != 4 {
		t.Fatal("avatar removal did not clear profile")
	}
	download(
		t,
		env,
		"GET",
		"/api/v1/me/avatar",
		owner.AccessToken,
		nil,
		404,
	)
	if cleanup(t, env) != 0 {
		t.Fatal("cleanup ignored the retention period")
	}
	env.Clock.Advance(time.Hour + time.Millisecond)
	if count := cleanup(t, env); count != 3 {
		t.Fatalf("cleanup purged %d records, want old avatars and stale upload", count)
	}
	files, err := os.ReadDir(env.StorageDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Fatal("retired avatar bytes were retained after cleanup")
	}
}

func TestConcurrentAvatarUpdatesHaveOneWinner(t *testing.T) {
	env := testenv.New(t)
	owner, _ := env.Owner(t)
	data := imageBytes(t)
	type outcome struct {
		result testenv.Result
		err    error
	}
	results := make(chan outcome, 2)
	var workers sync.WaitGroup
	for range 2 {
		workers.Go(func() {
			result, err := upload(
				env,
				"PUT",
				"/api/v1/me/avatar?expected_version=1",
				owner.AccessToken,
				"photo.png",
				"image/png",
				data,
			)
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
	}
	if statuses[200] != 1 || statuses[409] != 1 {
		t.Fatalf("avatar update statuses: %v", statuses)
	}
	var ready int64
	if err := env.DB.Table("assets").Where("state='ready'").Count(&ready).Error; err != nil {
		t.Fatal(err)
	}
	if ready != 1 {
		t.Fatal("concurrent updates published multiple avatars")
	}
	files, err := os.ReadDir(env.StorageDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 {
		t.Fatal("losing profile update wrote an unreachable object")
	}
}

func TestAvatarPublicationRollbackRetainsPreviousImage(t *testing.T) {
	env := testenv.New(t)
	owner, _ := env.Owner(t)
	data := imageBytes(t)
	result, err := upload(
		env,
		"PUT",
		"/api/v1/me/avatar?expected_version=1",
		owner.AccessToken,
		"first.png",
		"image/png",
		data,
	)
	first := testenv.Decode[avatarUser](t, requireResult(t, result, err, 200))
	if first.AvatarAssetID == nil {
		t.Fatal("first avatar is missing")
	}
	// The isolated fixture rejects only a replacement pointer after object bytes have been written.
	if err := env.DB.Exec("ALTER TABLE users ADD CONSTRAINT test_reject_avatar CHECK (avatar_asset_id = '" + *first.AvatarAssetID + "'::uuid) NOT VALID").Error; err != nil {
		t.Fatal(err)
	}
	result, err = upload(
		env,
		"PUT",
		"/api/v1/me/avatar?expected_version=2",
		owner.AccessToken,
		"second.png",
		"image/png",
		data,
	)
	requireResult(t, result, err, 500)
	current := testenv.Decode[avatarUser](t, env.Call(
		t,
		"GET",
		"/api/v1/me",
		owner.AccessToken,
		nil,
		200,
	))
	if current.AvatarAssetID == nil || *current.AvatarAssetID != *first.AvatarAssetID || current.Version != 2 {
		t.Fatal("failed publication changed the profile")
	}
	download(
		t,
		env,
		"GET",
		"/api/v1/me/avatar",
		owner.AccessToken,
		nil,
		200,
	)
	var staging int64
	if err := env.DB.Table("assets").Where("state='staging'").Count(&staging).Error; err != nil {
		t.Fatal(err)
	}
	if staging != 1 {
		t.Fatal("failed object lost its recovery record")
	}
	env.Clock.Advance(time.Hour + time.Millisecond)
	if cleanup(t, env) != 1 {
		t.Fatal("failed publication was not recoverable")
	}
	files, err := os.ReadDir(env.StorageDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 {
		t.Fatal("cleanup removed the active avatar or retained failed bytes")
	}
}
