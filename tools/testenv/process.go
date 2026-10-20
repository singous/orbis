package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const commandTimeout = 90 * time.Second

func randomID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		panic("system entropy unavailable")
	}
	return hex.EncodeToString(value[:])
}

func cleanEnvironment() []string {
	values := make([]string, 0, len(os.Environ()))
	for _, entry := range os.Environ() {
		name, _, _ := strings.Cut(entry, "=")
		if strings.HasPrefix(name, "ORBIS_") && name != "ORBIS_GO_BIN" {
			continue
		}
		values = append(values, entry)
	}
	return values
}

func command(ctx context.Context, directory string, environment []string, output io.Writer, executable string, args ...string) error {
	cmd := exec.CommandContext(ctx, executable, args...)
	cmd.Dir, cmd.Env, cmd.Stdout, cmd.Stderr = directory, environment, output, output
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		err := syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
	cmd.WaitDelay = 5 * time.Second
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// Arguments can contain credentials; only report the executable and exit state.
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return fmt.Errorf("%s exited with status %d", filepath.Base(executable), exit.ExitCode())
		}
		return fmt.Errorf("start %s", filepath.Base(executable))
	}
	return nil
}

func docker(ctx context.Context, args ...string) (string, error) {
	bounded, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()
	var output bytes.Buffer
	if err := command(bounded, "", os.Environ(), &output, "docker", args...); err != nil {
		return "", err
	}
	return strings.TrimSpace(output.String()), nil
}

func dockerCreate(ctx context.Context, args ...string) (string, error) {
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	// Let a dispatched creation settle before cleanup; killing its CLI can leave
	// the daemon creating the resource after a premature "not found" cleanup.
	creation, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	return docker(creation, args...)
}

func writeEnvironment(path string, values []string) error {
	if err := os.WriteFile(path, []byte(strings.Join(values, "\n")+"\n"), 0o600); err != nil {
		return errors.New("write private test environment")
	}
	return nil
}

func newRuntime(root string) (string, error) {
	parent := filepath.Join(root, ".dev", "testenv")
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return "", errors.New("create test runtime parent")
	}
	directory, err := os.MkdirTemp(parent, "run-")
	if err != nil {
		return "", errors.New("create owned test runtime")
	}
	return directory, nil
}

func goCommand(ctx context.Context, root string, environment []string, args ...string) error {
	return command(ctx, root, environment, os.Stdout, "sh", append([]string{"scripts/go.sh"}, args...)...)
}

func waitReady(ctx context.Context, timeout time.Duration, probe func(context.Context) bool) error {
	deadline, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		if deadline.Err() != nil {
			return deadline.Err()
		}
		if probe(deadline) {
			return nil
		}
		select {
		case <-deadline.Done():
			return deadline.Err()
		case <-ticker.C:
		}
	}
}
