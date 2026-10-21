package integration

import (
	"context"
	"errors"
	"testing"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/workspace"
)

type allowed struct{}

func (allowed) Require(context.Context, string, string, workspace.Permission) error { return nil }

type waitingRepository struct {
	started chan struct{}
	finish  chan struct{}
}

func (r waitingRepository) Import(context.Context, ImportCommand) (ImportResult, error) {
	return ImportResult{}, nil
}
func (r waitingRepository) Export(ctx context.Context, q ExportQuery) (ExportSnapshot, error) {
	r.started <- struct{}{}
	select {
	case <-ctx.Done():
		return ExportSnapshot{}, ctx.Err()
	case <-r.finish:
		return ExportSnapshot{Content: document.Content{Revision: document.Revision{Title: "Export", Version: 1}, Blocks: []document.Block{}}}, nil
	}
}
func TestTransfersBoundActiveWorkAndReleaseCanceledRequest(t *testing.T) {
	repo := waitingRepository{started: make(chan struct{}, MaxConcurrentTransfers+1), finish: make(chan struct{})}
	service := NewTransfers(repo, allowed{}, clock.System{})
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, MaxConcurrentTransfers)
	for range MaxConcurrentTransfers {
		go func() { _, err := service.Export(ctx, ExportQuery{}); done <- err }()
	}
	for range MaxConcurrentTransfers {
		select {
		case <-repo.started:
		case <-t.Context().Done():
			t.Fatal("export did not start")
		}
	}
	_, err := service.Export(t.Context(), ExportQuery{})
	var business *fault.Error
	if !errors.As(err, &business) || business.Code != "DOCUMENT_TRANSFER_BUSY" {
		t.Fatalf("expected bounded export: %v", err)
	}
	cancel()
	for range MaxConcurrentTransfers {
		if err := <-done; !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	}
	close(repo.finish)
	if _, err := service.Export(t.Context(), ExportQuery{}); err != nil {
		t.Fatalf("cancellation leaked a permit: %v", err)
	}
}
