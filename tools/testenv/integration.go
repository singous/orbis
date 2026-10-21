package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func integrationArguments(args []string) ([]string, error) {
	var packages, flags []string
	for i := 0; i < len(args); i++ {
		if args[i] == "--package" {
			i++
			if i == len(args) || !validTestPackage(args[i]) {
				return nil, errors.New("--package must select a package under ./tests/")
			}
			packages = append(packages, args[i])
		} else if value, found := strings.CutPrefix(args[i], "--package="); found {
			if !validTestPackage(value) {
				return nil, errors.New("--package must select a package under ./tests/")
			}
			packages = append(packages, value)
		} else {
			flags = append(flags, args[i])
		}
	}
	if len(packages) == 0 {
		packages = []string{"./tests/..."}
	}
	command := []string{"test", "-tags=integration", "-count=1", "-timeout=15m"}
	return append(append(command, flags...), packages...), nil
}

func validTestPackage(value string) bool {
	if !strings.HasPrefix(value, "./tests/") {
		return false
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == ".." || segment == "" {
			return false
		}
	}
	return true
}

func integration(ctx context.Context, root string, args []string) error {
	testArgs, err := integrationArguments(args)
	if err != nil {
		return err
	}
	runtime, err := newRuntime(root)
	if err != nil {
		return err
	}
	defer os.RemoveAll(runtime)
	image := os.Getenv("ORBIS_TEST_IMAGE")
	collaborationImage := os.Getenv("ORBIS_TEST_COLLABORATION_IMAGE")
	c, err := startCluster(ctx, runtime, image == "")
	if err != nil {
		return err
	}
	defer c.close()
	if err := c.startCollaboration(ctx, collaborationImage, image == ""); err != nil {
		return err
	}
	fmt.Println("Running Go integration tests on an owned disposable PostgreSQL/Redis cluster.")
	if image == "" {
		return goCommand(ctx, root, append(cleanEnvironment(), c.environment()...), testArgs...)
	}
	settings := filepath.Join(runtime, "tests.env")
	if err := writeEnvironment(settings, c.environment()); err != nil {
		return err
	}
	name := c.name + "_tests"
	c.containers = append(c.containers, name)
	args = []string{"run", "--rm", "--name", name, "--label", resourceLabel, "--user", fmt.Sprintf("%d:%d", os.Getuid(), os.Getgid()), "--network", "container:" + c.name, "--memory", "1536m", "--cpus", "2", "--mount", "type=bind,source=" + root + ",target=/workspace", "--workdir", "/workspace", "--env-file", settings, "--env", "GOCACHE=/workspace/.dev/cache/go-docker", "--env", "GOPATH=/workspace/.dev/go", "--entrypoint", "sh", image, "scripts/go.sh"}
	return command(ctx, root, cleanEnvironment(), os.Stdout, "docker", append(args, testArgs...)...)
}
