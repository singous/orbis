package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

func browserPort(name string) (string, error) {
	value := os.Getenv(name)
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return "", fmt.Errorf("%s must be a valid TCP port", name)
	}
	return strconv.Itoa(port), nil
}

func browser(ctx context.Context, root string) error {
	collaborationImage := os.Getenv("ORBIS_TEST_COLLABORATION_IMAGE")
	parent := os.Getenv("ORBIS_E2E_DIR")
	if parent == "" {
		return errors.New("ORBIS_E2E_DIR must name the browser-test runtime directory")
	}
	parent, err := filepath.Abs(parent)
	if err != nil {
		return errors.New("resolve browser-test runtime")
	}
	apiPort, err := browserPort("ORBIS_E2E_API_PORT")
	if err != nil {
		return err
	}
	webPort, err := browserPort("ORBIS_E2E_WEB_PORT")
	if err != nil {
		return err
	}
	if apiPort == webPort {
		return errors.New("browser-test API and frontend ports must be different")
	}
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return errors.New("create browser-test runtime")
	}
	runtime, err := os.MkdirTemp(parent, "native-")
	if err != nil {
		return errors.New("create owned browser-test runtime")
	}
	defer os.RemoveAll(runtime)
	c, err := startCluster(ctx, runtime, true)
	if err != nil {
		return err
	}
	defer c.close()
	if err := c.startCollaboration(ctx, collaborationImage, true); err != nil {
		return err
	}
	environment := append(cleanEnvironment(), c.appEnvironment()...)
	environment = append(environment,
		"GOTMPDIR="+runtime,
		"ORBIS_LISTEN_ADDRESS=127.0.0.1:"+apiPort,
		"ORBIS_PUBLIC_BASE_URL=http://127.0.0.1:"+webPort,
		"ORBIS_STORAGE_DIR="+filepath.Join(runtime, "objects"),
		"ORBIS_MAIL_TRANSPORT=outbox",
		"ORBIS_MAIL_OUTBOX_DIR="+filepath.Join(runtime, "outbox"),
		"GIN_MODE=release",
	)
	binary := filepath.Join(runtime, "orbis-server")
	build, cancel := context.WithTimeout(ctx, 3*time.Minute)
	err = goCommand(build, root, environment, "build", "-trimpath", "-buildvcs=false", "-o", binary, "./cmd/server")
	cancel()
	if err != nil {
		return fmt.Errorf("build browser-test server: %w", err)
	}
	if err := os.Chmod(binary, 0o755); err != nil {
		return errors.New("make owned browser-test binary executable")
	}
	migrate, cancel := context.WithTimeout(ctx, time.Minute)
	err = command(migrate, root, environment, os.Stdout, binary, "migrate")
	cancel()
	if err != nil {
		return fmt.Errorf("migrate browser-test database: %w", err)
	}
	return serveBrowser(ctx, root, environment, binary)
}

func serveBrowser(ctx context.Context, root string, environment []string, binary string) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	server := exec.Command(binary, "serve")
	server.Dir, server.Env, server.Stdout, server.Stderr = root, environment, os.Stdout, os.Stderr
	server.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := server.Start(); err != nil {
		return errors.New("start browser-test server")
	}
	// This owner joins the only wait goroutine, including cancellation and startup failure.
	done := make(chan error, 1)
	go func() { done <- server.Wait() }()
	select {
	case err := <-done:
		if err == nil {
			return errors.New("browser-test server stopped before cancellation")
		}
		return errors.New("browser-test server exited unexpectedly")
	case <-ctx.Done():
		_ = server.Process.Signal(syscall.SIGTERM)
		timer := time.NewTimer(40 * time.Second)
		defer timer.Stop()
		select {
		case err := <-done:
			if err != nil {
				return errors.New("browser-test server failed graceful shutdown")
			}
			return ctx.Err()
		case <-timer.C:
			_ = syscall.Kill(-server.Process.Pid, syscall.SIGKILL)
			<-done
			return errors.New("browser-test server exceeded graceful shutdown deadline")
		}
	}
}
