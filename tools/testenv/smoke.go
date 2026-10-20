package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

func smoke(ctx context.Context, root string, args []string) error {
	flags := flag.NewFlagSet("smoke", flag.ContinueOnError)
	backend := flags.String("backend-image", "", "Backend image to verify")
	frontend := flags.String("frontend-image", "", "Optional frontend image to verify")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *backend == "" || flags.NArg() != 0 {
		return errors.New("smoke requires --backend-image IMAGE [--frontend-image IMAGE]")
	}
	runtime, err := newRuntime(root)
	if err != nil {
		return err
	}
	defer os.RemoveAll(runtime)
	c, err := startCluster(ctx, runtime, false)
	if err != nil {
		return err
	}
	defer c.close()
	return smokeImages(ctx, c, *backend, *frontend)
}

func smokeImages(ctx context.Context, c *cluster, backendImage, frontendImage string) error {
	image, err := docker(ctx, "image", "inspect", backendImage, "--format", "{{.Id}}")
	if err != nil {
		return fmt.Errorf("inspect backend image: %w", err)
	}
	settings := filepath.Join(c.runtime, "app.env")
	if err := writeEnvironment(settings, c.appEnvironment()); err != nil {
		return err
	}
	shared := []string{"--network", "container:" + c.name, "--env-file", settings}
	migration := c.name + "_migrate"
	c.containers = append(c.containers, migration)
	args := append([]string{"run", "--rm", "--name", migration, "--label", resourceLabel}, shared...)
	if _, err := docker(ctx, append(args, image, "migrate")...); err != nil {
		return fmt.Errorf("migrate backend image: %w", err)
	}
	name := c.name + "_api"
	c.containers = append(c.containers, name)
	args = []string{"run", "--detach", "--name", name, "--label", resourceLabel, "--memory", "384m", "--cpus", "1"}
	args = append(args, shared...)
	if _, err := dockerCreate(ctx, append(args, image, "serve")...); err != nil {
		return fmt.Errorf("start backend image: %w", err)
	}
	if err := waitReady(ctx, 30*time.Second, func(ctx context.Context) bool {
		_, err := docker(ctx, "exec", name, "/orbis-server", "-healthcheck")
		return err == nil
	}); err != nil {
		return fmt.Errorf("backend readiness: %w", err)
	}
	var web *frontendSmoke
	if frontendImage != "" {
		web = &frontendSmoke{cluster: c.name, image: frontendImage, probe: "capability-" + randomID()}
		defer web.close()
		if err := web.start(ctx); err != nil {
			return err
		}
		if err := web.verify(ctx); err != nil {
			return err
		}
	}
	if _, err := docker(ctx, "exec", name, "/orbis-server", "gc-assets"); err != nil {
		return fmt.Errorf("backend asset maintenance: %w", err)
	}
	count, err := docker(ctx, "exec", c.name, "psql", "-U", "orbis_test", "-d", "orbis_test", "-Atc", "SELECT count(*) FROM users")
	if err != nil || count != "0" {
		return errors.New("backend startup unexpectedly initialized users or failed the user check")
	}
	if _, err := docker(ctx, "stop", "--time", "20", name); err != nil {
		return errors.New("stop backend image")
	}
	exit, err := docker(ctx, "inspect", name, "--format", "{{.State.ExitCode}}")
	if err != nil || exit != "0" {
		return errors.New("backend image did not shut down gracefully")
	}
	if web != nil {
		if err := web.verifyUpstreamFailure(ctx); err != nil {
			return err
		}
	}
	fmt.Println("Backend image smoke passed: migration, readiness, asset maintenance, no user initialization, graceful shutdown.")
	return nil
}

type frontendSmoke struct {
	cluster, image, probe, origin      string
	networkCreated, connected, started bool
}

func (w *frontendSmoke) network() string   { return w.cluster + "_web_network" }
func (w *frontendSmoke) container() string { return w.cluster + "_web" }

func (w *frontendSmoke) start(ctx context.Context) error {
	w.networkCreated = true
	if _, err := dockerCreate(ctx, "network", "create", "--label", resourceLabel, w.network()); err != nil {
		return errors.New("create frontend smoke network")
	}
	w.connected = true
	if _, err := dockerCreate(ctx, "network", "connect", "--alias", "api", w.network(), w.cluster); err != nil {
		return errors.New("connect frontend smoke network")
	}
	w.started = true
	if _, err := dockerCreate(ctx, "run", "--detach", "--name", w.container(), "--label", resourceLabel, "--network", w.network(), "--publish", "127.0.0.1::80", "--memory", "128m", "--cpus", "0.5", w.image); err != nil {
		return errors.New("start frontend smoke image")
	}
	port, err := publishedPort(ctx, w.container(), "80/tcp")
	if err != nil {
		return err
	}
	w.origin = "http://127.0.0.1:" + port
	if err := waitReady(ctx, 20*time.Second, func(ctx context.Context) bool {
		response, err := w.read(ctx, "/healthz")
		return err == nil && response.status == http.StatusOK
	}); err != nil {
		return fmt.Errorf("frontend image readiness: %w", err)
	}
	return nil
}

type smokeResponse struct {
	status int
	header http.Header
	body   []byte
}

func (w *frontendSmoke) read(ctx context.Context, path string) (smokeResponse, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, w.origin+path, nil)
	if err != nil {
		return smokeResponse{}, errors.New("create frontend smoke request")
	}
	request.Header.Set("Authorization", "Bearer "+w.probe)
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return smokeResponse{}, errors.New("frontend smoke request failed")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024+1))
	if err != nil || len(body) > 2*1024*1024 {
		return smokeResponse{}, errors.New("read bounded frontend smoke response")
	}
	return smokeResponse{response.StatusCode, response.Header, body}, nil
}

func (w *frontendSmoke) verify(ctx context.Context) error {
	if err := w.verifyHTTP(ctx); err != nil {
		return err
	}
	return w.verifyLogs(ctx)
}

func (w *frontendSmoke) verifyHTTP(ctx context.Context) error {
	r, err := w.read(ctx, "/api/v1/setup?private="+w.probe)
	var setup struct {
		Code      string `json:"code"`
		RequestID string `json:"request_id"`
		Data      struct {
			Initialized *bool `json:"initialized"`
		} `json:"data"`
	}
	if err != nil || json.Unmarshal(r.body, &setup) != nil || r.status != 200 || setup.Code != "OK" || setup.Data.Initialized == nil || *setup.Data.Initialized || setup.RequestID == "" || setup.RequestID != r.header.Get("X-Request-ID") {
		return errors.New("frontend did not preserve the native API path and envelope")
	}
	r, err = w.read(ctx, "/api/v1/not-a-route")
	var failure struct {
		Code string `json:"code"`
	}
	if err != nil || json.Unmarshal(r.body, &failure) != nil || r.status != 404 || failure.Code != "RESOURCE_NOT_FOUND" {
		return errors.New("frontend proxy did not preserve native API errors")
	}
	r, err = w.read(ctx, "/share/"+w.probe+"?token="+w.probe)
	scripts := regexp.MustCompile(`<script[^>]+src="(/assets/[^"<>]+\.js)"`).FindSubmatch(r.body)
	if err != nil || r.status != 200 || !strings.Contains(r.header.Get("Content-Type"), "text/html") || len(scripts) != 2 {
		return errors.New("frontend SPA or immutable script delivery failed")
	}
	r, err = w.read(ctx, string(scripts[1]))
	if err != nil || r.status != 200 || !strings.Contains(r.header.Get("Content-Type"), "javascript") || len(r.body) == 0 {
		return errors.New("frontend scripts were not served as static JavaScript")
	}
	r, err = w.read(ctx, "/assets/not-an-asset.js")
	if err != nil || r.status != 404 {
		return errors.New("missing frontend static assets must return 404")
	}
	r, err = w.read(ctx, "/api/v1/public/shares/"+w.probe+"/directory?token="+w.probe)
	if err != nil || r.status != 404 {
		return errors.New("invalid public capability did not use the native API")
	}
	if _, err := w.read(ctx, "/invite/"+w.probe+"?token="+w.probe); err != nil {
		return err
	}
	return nil
}

func (w *frontendSmoke) verifyUpstreamFailure(ctx context.Context) error {
	r, err := w.read(ctx, "/api/v1/public/shares/"+w.probe+"/directory?token="+w.probe)
	if err != nil || r.status != 502 {
		return errors.New("frontend did not report an unavailable upstream")
	}
	if err := w.verifyLogs(ctx); err != nil {
		return err
	}
	fmt.Println("Frontend image smoke passed: SPA/static assets, native proxy, capability log redaction, upstream failure.")
	return nil
}

func (w *frontendSmoke) verifyLogs(ctx context.Context) error {
	logs, err := docker(ctx, "logs", w.container())
	if err != nil {
		return errors.New("read owned frontend smoke logs")
	}
	if strings.Contains(logs, w.probe) {
		return errors.New("frontend logs exposed a capability or request credential")
	}
	return nil
}

func (w *frontendSmoke) close() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if w.started {
		_, _ = docker(ctx, "rm", "--force", w.container())
	}
	if w.connected {
		_, _ = docker(ctx, "network", "disconnect", w.network(), w.cluster)
	}
	if w.networkCreated {
		_, _ = docker(ctx, "network", "rm", w.network())
	}
}
