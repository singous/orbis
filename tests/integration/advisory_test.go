//go:build integration

package integration_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"orbis.local/orbis/internal/platform/database"
	"orbis.local/orbis/tests/testenv"
)

func TestImportOwnershipSurvivesCancellationUntilActualWorkStops(t *testing.T) {
	env := testenv.New(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	started, release := make(chan struct{}), make(chan struct{})
	finished := make(chan error, 1)
	const key int64 = 803570126410
	go func() {
		finished <- database.WithAdvisoryOwner(ctx, env.DB, key, func() error { close(started); <-release; return ctx.Err() })
	}()
	released := false
	joined := false
	defer func() {
		if !released {
			close(release)
		}
		if !joined {
			select {
			case <-finished:
			case <-time.After(5 * time.Second):
			}
		}
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("advisory owner did not start")
	}
	cancel()
	called := false
	err := database.WithAdvisoryOwner(t.Context(), env.DB, key, func() error { called = true; return nil })
	if !errors.Is(err, database.ErrAdvisoryBusy) || called {
		t.Fatal("canceled but still running work lost its exclusive ownership")
	}
	close(release)
	released = true
	select {
	case err := <-finished:
		joined = true
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("owner did not release its resources")
	}
	if err := database.WithAdvisoryOwner(t.Context(), env.DB, key, func() error { return nil }); err != nil {
		t.Fatal("completed owner retained its lock")
	}
}
