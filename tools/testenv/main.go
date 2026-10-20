// Command testenv owns disposable integration, browser, and image test resources.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		if errors.Is(err, context.Canceled) && ctx.Err() != nil {
			return
		}
		fmt.Fprintln(os.Stderr, "testenv:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Println("Usage: sh scripts/testenv.sh [--root DIRECTORY] <integration|e2e|smoke|compose> [options]\n" +
		"  integration [--package ./tests/module]... [go test flags]\n" +
		"  e2e (requires ORBIS_E2E_DIR, ORBIS_E2E_API_PORT, ORBIS_E2E_WEB_PORT)\n" +
		"  smoke --backend-image IMAGE [--frontend-image IMAGE]\n" +
		"  compose --backend-image IMAGE --frontend-image IMAGE --collaboration-image IMAGE")
}

func run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		usage()
		return nil
	}
	flags := flag.NewFlagSet("testenv", flag.ContinueOnError)
	flags.Usage = usage
	rootOption := flags.String("root", "", "Project root; defaults to the nearest Go project")
	if err := flags.Parse(args); err != nil {
		return err
	}
	args = flags.Args()
	if len(args) == 0 {
		usage()
		return errors.New("choose integration, e2e, smoke, or compose")
	}
	root, err := projectRoot(*rootOption)
	if err != nil {
		return err
	}
	switch args[0] {
	case "integration":
		return integration(ctx, root, args[1:])
	case "e2e":
		if len(args) != 1 {
			return errors.New("e2e does not accept arguments")
		}
		return browser(ctx, root)
	case "smoke":
		return smoke(ctx, root, args[1:])
	case "compose":
		return compose(ctx, root, args[1:])
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func projectRoot(explicit string) (string, error) {
	directory, err := os.Getwd()
	if err != nil {
		return "", errors.New("read working directory")
	}
	if explicit != "" {
		directory, err = filepath.Abs(explicit)
		if err != nil || !isProjectRoot(directory) {
			return "", errors.New("--root requires go.mod, .go-version, and scripts/go.sh")
		}
		return directory, nil
	}
	for {
		if isProjectRoot(directory) {
			return directory, nil
		}
		parent := filepath.Dir(directory)
		if directory == parent {
			return "", errors.New("run testenv inside a Go project or select --root")
		}
		directory = parent
	}
}

func isProjectRoot(directory string) bool {
	for _, relative := range []string{"go.mod", ".go-version", filepath.Join("scripts", "go.sh")} {
		info, err := os.Stat(filepath.Join(directory, relative))
		if err != nil || !info.Mode().IsRegular() {
			return false
		}
	}
	return true
}
