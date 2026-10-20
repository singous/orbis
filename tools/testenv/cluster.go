package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

const (
	postgresImage = "postgres@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d"
	redisImage    = "redis@sha256:b362b5dff9d14d961dc3352db4776aba6a8c53ca2661d7c74ad2c121f82cdaea"
	resourceLabel = "orbis.disposable-test=true"
)

type cluster struct {
	name, password, runtime            string
	databasePort, redisPort            string
	collaborationURL, collaborationKey string
	containers                         []string
}

func startCluster(ctx context.Context, runtime string, publish bool) (*cluster, error) {
	c := &cluster{name: "orbis_test_" + randomID(), password: randomID() + randomID(), runtime: runtime, databasePort: "5432", redisPort: "6379"}
	settings := filepath.Join(runtime, "postgres.env")
	if err := writeEnvironment(settings, []string{"POSTGRES_USER=orbis_test", "POSTGRES_DB=orbis_test", "POSTGRES_PASSWORD=" + c.password}); err != nil {
		return nil, err
	}
	args := []string{"run", "--detach", "--rm", "--name", c.name, "--label", resourceLabel, "--memory", "384m", "--cpus", "1", "--tmpfs", "/var/lib/postgresql/data:rw,size=256m", "--env-file", settings}
	if publish {
		args = append(args, "--publish", "127.0.0.1::5432")
	}
	args = append(args, postgresImage, "postgres", "-c", "cluster_name="+c.name)
	// Record ownership before invoking Docker: cancellation can race container creation.
	c.containers = append(c.containers, c.name)
	if _, err := dockerCreate(ctx, args...); err != nil {
		c.close()
		return nil, fmt.Errorf("start disposable PostgreSQL: %w", err)
	}
	redis := c.name + "_redis"
	args = []string{"run", "--detach", "--rm", "--name", redis, "--label", resourceLabel, "--memory", "128m", "--cpus", "0.5", "--tmpfs", "/data:rw,size=96m"}
	if publish {
		args = append(args, "--publish", "127.0.0.1::6379")
	} else {
		args = append(args, "--network", "container:"+c.name)
	}
	bind := "127.0.0.1"
	if publish {
		bind = "0.0.0.0"
	}
	args = append(args, redisImage, "redis-server", "--bind", bind, "--save", "", "--appendonly", "no", "--maxmemory", "96mb", "--maxmemory-policy", "noeviction")
	c.containers = append(c.containers, redis)
	if _, err := dockerCreate(ctx, args...); err != nil {
		c.close()
		return nil, fmt.Errorf("start disposable Redis: %w", err)
	}
	if err := waitReady(ctx, 30*time.Second, func(ctx context.Context) bool {
		_, err := docker(ctx, "exec", c.name, "pg_isready", "-U", "orbis_test", "-d", "orbis_test")
		return err == nil
	}); err != nil {
		c.close()
		return nil, fmt.Errorf("wait for disposable PostgreSQL: %w", err)
	}
	if err := waitReady(ctx, 30*time.Second, func(ctx context.Context) bool {
		output, err := docker(ctx, "exec", redis, "redis-cli", "ping")
		return err == nil && output == "PONG"
	}); err != nil {
		c.close()
		return nil, fmt.Errorf("wait for disposable Redis: %w", err)
	}
	if publish {
		var err error
		c.databasePort, err = publishedPort(ctx, c.name, "5432/tcp")
		if err == nil {
			c.redisPort, err = publishedPort(ctx, redis, "6379/tcp")
		}
		if err != nil {
			c.close()
			return nil, err
		}
	}
	fmt.Println("Owned disposable PostgreSQL/Redis cluster:", c.name)
	return c, nil
}

func (c *cluster) databaseURL() string {
	u := url.URL{Scheme: "postgres", User: url.UserPassword("orbis_test", c.password), Host: "127.0.0.1:" + c.databasePort, Path: "/orbis_test", RawQuery: "sslmode=disable&connect_timeout=5"}
	return u.String()
}

func (c *cluster) environment() []string {
	values := []string{"ORBIS_TEST_DATABASE_URL=" + c.databaseURL(), "ORBIS_TEST_CLUSTER_ID=" + c.name, "ORBIS_TEST_REDIS_URL=redis://127.0.0.1:" + c.redisPort + "/0", "GIN_MODE=release", "GOMAXPROCS=2"}
	if c.collaborationURL != "" {
		values = append(values, "ORBIS_TEST_COLLABORATION_URL="+c.collaborationURL, "ORBIS_TEST_COLLABORATION_KEY="+c.collaborationKey)
	}
	return values
}

func (c *cluster) appEnvironment() []string {
	values := []string{"ORBIS_DATABASE_URL=" + c.databaseURL(), "ORBIS_REDIS_URL=redis://127.0.0.1:" + c.redisPort + "/0", "ORBIS_SIGNING_KEY=" + randomID() + randomID()}
	if c.collaborationURL != "" {
		values = append(values, "ORBIS_COLLABORATION_URL="+c.collaborationURL, "ORBIS_COLLABORATION_KEY="+c.collaborationKey)
	}
	return values
}

func (c *cluster) startCollaboration(ctx context.Context, image string, publish bool) error {
	if image == "" {
		return nil
	}
	immutable, err := docker(ctx, "image", "inspect", image, "--format", "{{.Id}}")
	if err != nil {
		return errors.New("inspect the explicitly selected local collaboration test image")
	}
	c.collaborationKey = randomID() + randomID()
	settings := filepath.Join(c.runtime, "collaboration.env")
	bind := "127.0.0.1"
	if publish {
		bind = "0.0.0.0"
	}
	if err := writeEnvironment(settings, []string{"ORBIS_COLLABORATION_KEY=" + c.collaborationKey, "ORBIS_COLLABORATION_HOST=" + bind, "ORBIS_COLLABORATION_PORT=9203"}); err != nil {
		return err
	}
	name := c.name + "_collaboration"
	args := []string{"run", "--detach", "--rm", "--init", "--read-only", "--name", name, "--label", resourceLabel, "--memory", "1536m", "--cpus", "2", "--env-file", settings}
	if publish {
		args = append(args, "--publish", "127.0.0.1::9203")
	} else {
		args = append(args, "--network", "container:"+c.name)
	}
	c.containers = append(c.containers, name)
	if _, err := dockerCreate(ctx, append(args, immutable)...); err != nil {
		return fmt.Errorf("start owned collaboration engine: %w", err)
	}
	if err := waitReady(ctx, 30*time.Second, func(ctx context.Context) bool {
		_, err := docker(ctx, "exec", name, "node", "-e", "fetch('http://127.0.0.1:9203/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))")
		return err == nil
	}); err != nil {
		return fmt.Errorf("wait for owned collaboration engine: %w", err)
	}
	port := "9203"
	if publish {
		port, err = publishedPort(ctx, name, "9203/tcp")
		if err != nil {
			return err
		}
	}
	c.collaborationURL = "http://127.0.0.1:" + port
	fmt.Println("Owned disposable collaboration engine:", name)
	return nil
}

func (c *cluster) close() {
	// Cleanup is bounded and intentionally outlives cancellation of the test operation.
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	for i := len(c.containers) - 1; i >= 0; i-- {
		if _, err := docker(ctx, "inspect", c.containers[i]); err != nil {
			continue // --rm test containers can already have disappeared after success.
		}
		if _, err := docker(ctx, "rm", "--force", c.containers[i]); err != nil {
			fmt.Fprintln(os.Stderr, "testenv: could not remove an owned disposable container")
		}
	}
}

func publishedPort(ctx context.Context, container, key string) (string, error) {
	output, err := docker(ctx, "inspect", container)
	if err != nil {
		return "", errors.New("inspect owned container port")
	}
	var values []struct {
		NetworkSettings struct {
			Ports map[string][]struct{ HostPort string }
		}
	}
	if json.Unmarshal([]byte(output), &values) != nil || len(values) != 1 || len(values[0].NetworkSettings.Ports[key]) != 1 {
		return "", errors.New("owned container has no unique loopback port")
	}
	return values[0].NetworkSettings.Ports[key][0].HostPort, nil
}
