//go:build integration

package integration_test

import (
	"context"
	"io"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"orbis.local/orbis/internal/platform/tasks"
	"orbis.local/orbis/tests/testenv"
)

type blockedImport struct {
	id         string
	mu         sync.Mutex
	dispatched bool
	started    chan struct{}
	canceled   chan struct{}
	release    chan struct{}
}

func (r *blockedImport) DispatchImports(ctx context.Context, dispatch func(context.Context, string, bool) error) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.dispatched {
		return nil
	}
	if err := dispatch(ctx, r.id, false); err != nil {
		return err
	}
	r.dispatched = true
	return nil
}
func (r *blockedImport) ProcessImport(ctx context.Context, id string) error {
	close(r.started)
	<-ctx.Done()
	close(r.canceled)
	<-r.release
	return ctx.Err()
}
func TestImportRuntimeShutdownCancelsAndJoinsHandler(t *testing.T) {
	testenv.New(t) // Validates the disposable cluster identity before accessing its Redis instance.
	repo := &blockedImport{id: uuid.NewString(), started: make(chan struct{}), canceled: make(chan struct{}), release: make(chan struct{})}
	runtime, err := tasks.StartImports(t.Context(), os.Getenv("ORBIS_TEST_REDIS_URL"), uuid.NewString(), repo, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(repo.release) }) }
	defer func() { release(); _ = runtime.Close() }()
	select {
	case <-repo.started:
	case <-time.After(10 * time.Second):
		t.Fatal("worker did not start")
	}
	closed := make(chan error, 1)
	go func() { closed <- runtime.Close() }()
	select {
	case <-repo.canceled:
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown did not cancel the owned handler")
	}
	select {
	case err := <-closed:
		t.Fatalf("shutdown returned before its handler finished: %v", err)
	default:
	}
	release()
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("shutdown did not join the handler")
	}
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
}
