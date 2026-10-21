package main

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestIntegrationArgumentsRetainPackageAndGoFlags(t *testing.T) {
	got, err := integrationArguments([]string{"--package", "./tests/table", "-race", "-run", "Copy|History", "--package=./tests/document"})
	want := []string{"test", "-tags=integration", "-count=1", "-timeout=15m", "-race", "-run", "Copy|History", "./tests/table", "./tests/document"}
	if err != nil || !slices.Equal(got, want) {
		t.Fatalf("integration arguments = %q, %v; want %q", got, err, want)
	}
	for _, args := range [][]string{{"--package"}, {"--package=../other"}, {"--package", "./tests/../../other"}} {
		if _, err := integrationArguments(args); err == nil {
			t.Fatalf("unsafe package selector accepted: %q", args)
		}
	}
	got, err = integrationArguments([]string{"--package", "./tests/..."})
	if err != nil || got[len(got)-1] != "./tests/..." {
		t.Fatalf("integration subtree selector rejected: %v", err)
	}
}

func TestEnvironmentDoesNotInheritDeploymentCredentials(t *testing.T) {
	t.Setenv("ORBIS_DATABASE_URL", "postgres://deployment-credential@shared/database")
	t.Setenv("ORBIS_TEST_DATABASE_URL", "postgres://other-test/cluster")
	t.Setenv("ORBIS_E2E_DIR", "/untrusted/runtime")
	t.Setenv("ORBIS_GO_SIGNING_KEY", "previous-server-secret")
	t.Setenv("ORBIS_TOKEN", "cli-secret")
	t.Setenv("ORBIS_GO_BIN", "/explicit/toolchain")
	environment := cleanEnvironment()
	if !slices.Contains(environment, "ORBIS_GO_BIN=/explicit/toolchain") {
		t.Fatal("toolchain selector was discarded")
	}
	for _, value := range environment {
		if strings.HasPrefix(value, "ORBIS_") && !strings.HasPrefix(value, "ORBIS_GO_BIN=") {
			t.Fatalf("test child inherited product configuration %q", strings.SplitN(value, "=", 2)[0])
		}
	}
}

func TestCanceledCommandWaitsForOwnedProcessGroup(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()
	started := time.Now()
	err := command(ctx, "", cleanEnvironment(), io.Discard, "sh", "-c", "trap 'exit 0' TERM; while :; do sleep 10; done")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("canceled command = %v", err)
	}
	if time.Since(started) > 3*time.Second {
		t.Fatal("cancellation did not stop and join the child process group promptly")
	}
}

func TestBrowserServerShutsDownOnOwnerCancellation(t *testing.T) {
	directory := t.TempDir()
	binary := filepath.Join(directory, "owned-server")
	ready := filepath.Join(directory, "ready")
	stopped := filepath.Join(directory, "stopped")
	if err := os.WriteFile(binary, []byte("#!/bin/sh\ntrap 'touch \"$TEST_STOPPED\"; exit 0' TERM\ntouch \"$TEST_READY\"\nwhile :; do sleep 0.1; done\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- serveBrowser(ctx, directory, append(cleanEnvironment(), "TEST_READY="+ready, "TEST_STOPPED="+stopped), binary)
	}()
	if err := waitReady(t.Context(), 3*time.Second, func(context.Context) bool { _, err := os.Stat(ready); return err == nil }); err != nil {
		t.Fatal("owned fake server did not start")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("browser shutdown = %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("browser server did not stop and join")
	}
	if _, err := os.Stat(stopped); err != nil {
		t.Fatal("browser server did not receive graceful termination")
	}
}

func TestBrowserPortsRejectInvalidInput(t *testing.T) {
	for _, value := range []string{"", "0", "65536", "tcp://localhost:80"} {
		t.Setenv("ORBIS_E2E_API_PORT", value)
		if _, err := browserPort("ORBIS_E2E_API_PORT"); err == nil {
			t.Fatalf("invalid port %q accepted", value)
		}
	}
}

func TestExplicitRootSupportsIndependentMigrationProject(t *testing.T) {
	directory := t.TempDir()
	if err := os.Mkdir(filepath.Join(directory, "scripts"), 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"go.mod", ".go-version", "scripts/go.sh"} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte("fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	root, err := projectRoot(directory)
	if err != nil || root != directory {
		t.Fatalf("independent root = %q, %v", root, err)
	}
	if err := os.Remove(filepath.Join(directory, "scripts", "go.sh")); err != nil {
		t.Fatal(err)
	}
	if _, err := projectRoot(directory); err == nil {
		t.Fatal("incomplete independent project root accepted")
	}
}

func TestDispatchedResourceCreationSettlesBeforeCanceledOwnerCleansUp(t *testing.T) {
	directory := t.TempDir()
	ready := filepath.Join(directory, "request-started")
	created := filepath.Join(directory, "resource-created")
	if err := os.WriteFile(filepath.Join(directory, "docker"), []byte("#!/bin/sh\ntouch \"$TEST_CREATION_READY\"\nsleep 0.3\ntouch \"$TEST_CREATION_DONE\"\nprintf 'owned-resource'\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", directory+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("TEST_CREATION_READY", ready)
	t.Setenv("TEST_CREATION_DONE", created)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := dockerCreate(ctx, "run"); done <- err }()
	if err := waitReady(t.Context(), 3*time.Second, func(context.Context) bool { _, err := os.Stat(ready); return err == nil }); err != nil {
		t.Fatal("creation request did not start")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("dispatched creation was interrupted: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("dispatched creation did not settle")
	}
	if _, err := os.Stat(created); err != nil {
		t.Fatal("owner could begin cleanup before the creation settled")
	}
	if err := os.Remove(created); err != nil {
		t.Fatal(err)
	}
	if _, err := dockerCreate(ctx, "run"); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled owner dispatched another creation: %v", err)
	}
	if _, err := os.Stat(created); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("canceled owner created another resource")
	}
}
