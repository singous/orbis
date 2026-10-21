package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"
)

const composeProjectLabel = "com.docker.compose.project"

var composeProjectPattern = regexp.MustCompile(`^orbis_compose_[a-f0-9]{32}$`)

type composeService struct {
	ContainerName string                 `json:"container_name"`
	Image         string                 `json:"image"`
	Environment   map[string]string      `json:"environment"`
	Healthcheck   struct{ Disable bool } `json:"healthcheck"`
	Ports         []struct {
		HostIP    string `json:"host_ip"`
		Published string `json:"published"`
		Target    int    `json:"target"`
	} `json:"ports"`
	Volumes []struct {
		Type, Source, Target string
	} `json:"volumes"`
}

type composeConfig struct {
	Name     string                    `json:"name"`
	Services map[string]composeService `json:"services"`
	Volumes  map[string]composeVolume  `json:"volumes"`
	Networks map[string]composeNetwork `json:"networks"`
}

type composeVolume struct {
	Name     string `json:"name"`
	External bool   `json:"external"`
}

type composeNetwork struct {
	Name     string `json:"name"`
	External bool   `json:"external"`
}

type composeProject struct {
	root, runtime, name, envFile               string
	backend, frontend, collaboration, password string
	config                                     composeConfig
	environment                                []string
	registered, attempted                      bool
}

func compose(ctx context.Context, root string, args []string) (result error) {
	flags := flag.NewFlagSet("compose", flag.ContinueOnError)
	backend := flags.String("backend-image", "", "Backend image to verify")
	frontend := flags.String("frontend-image", "", "Frontend image to verify")
	collaboration := flags.String("collaboration-image", "", "Collaboration engine image to verify")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *backend == "" || *frontend == "" || *collaboration == "" || flags.NArg() != 0 {
		return errors.New("compose requires --backend-image IMAGE --frontend-image IMAGE --collaboration-image IMAGE")
	}
	runtime, err := newRuntime(root)
	if err != nil {
		return err
	}
	defer os.RemoveAll(runtime)
	p := &composeProject{root: root, runtime: runtime, name: "orbis_compose_" + randomID(), envFile: filepath.Join(runtime, "compose.env"), password: randomID() + randomID()}
	defer func() { result = errors.Join(result, p.close()) }()
	p.backend, err = docker(ctx, "image", "inspect", *backend, "--format", "{{.Id}}")
	if err == nil {
		p.frontend, err = docker(ctx, "image", "inspect", *frontend, "--format", "{{.Id}}")
	}
	if err == nil {
		p.collaboration, err = docker(ctx, "image", "inspect", *collaboration, "--format", "{{.Id}}")
	}
	if err != nil {
		return errors.New("inspect locally built Compose images")
	}
	p.environment = []string{
		"ORBIS_API_IMAGE=" + p.backend, "ORBIS_WEB_IMAGE=" + p.frontend,
		"ORBIS_COLLABORATION_IMAGE=" + p.collaboration,
		"ORBIS_COLLABORATION_KEY=" + randomID() + randomID(),
		"ORBIS_DATABASE_PASSWORD=" + p.password,
		"ORBIS_SIGNING_KEY=" + randomID() + randomID(),
		"ORBIS_BIND_ADDRESS=127.0.0.1", "ORBIS_PORT=0",
		"ORBIS_PUBLIC_BASE_URL=http://127.0.0.1", "ORBIS_MAIL_TRANSPORT=disabled",
	}
	if err := writeEnvironment(p.envFile, p.environment); err != nil {
		return err
	}
	configured, err := p.invoke(ctx, false, "--profile", "maintenance", "config", "--format", "json")
	if err != nil {
		return fmt.Errorf("validate Compose configuration: %w", err)
	}
	if err := json.Unmarshal([]byte(configured), &p.config); err != nil {
		return errors.New("decode resolved Compose configuration")
	}
	if err := p.validateConfiguration(); err != nil {
		return err
	}
	if err := p.configurationMatrix(ctx); err != nil {
		return err
	}
	resources, err := p.resources(ctx)
	if err != nil || len(resources) != 0 {
		return errors.New("refuse a Compose project with pre-existing or uninspectable resources")
	}
	for _, kind := range []string{"volume", "network"} {
		existing, err := docker(ctx, kind, "ls", "--quiet", "--filter", "name="+p.name)
		if err != nil || existing != "" {
			return errors.New("refuse pre-existing resources in the reserved Compose namespace")
		}
	}
	p.registered = true
	fmt.Println("Owned disposable Compose project:", p.name)
	if err := p.accept(ctx); err != nil {
		return err
	}
	fmt.Println("Compose acceptance passed: configuration, explicit migration, health, HTTP/static proxy, persistent database/queue/files, maintenance, idempotent migration and restart, no user initialization.")
	return nil
}

func composeEnvironment() []string {
	return slices.DeleteFunc(cleanEnvironment(), func(value string) bool { return strings.HasPrefix(value, "COMPOSE_") })
}

func (p *composeProject) invoke(ctx context.Context, mutation bool, args ...string) (string, error) {
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if mutation && (!p.registered || !composeProjectPattern.MatchString(p.name)) {
		return "", errors.New("Compose resource ownership is not registered")
	}
	operation := ctx
	timeout := 30 * time.Second
	if mutation {
		p.attempted = true
		// The daemon must finish a dispatched creation before ownership cleanup starts.
		operation = context.WithoutCancel(ctx)
		timeout = 2 * time.Minute
	}
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < timeout {
		timeout = time.Until(deadline)
	}
	operation, cancel := context.WithTimeout(operation, timeout)
	defer cancel()
	arguments := []string{"compose", "--project-name", p.name, "--project-directory", p.root, "--env-file", p.envFile, "--file", filepath.Join(p.root, "deploy", "compose.yaml")}
	var output bytes.Buffer
	if err := command(operation, p.root, composeEnvironment(), &output, "docker", append(arguments, args...)...); err != nil {
		return "", err
	}
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	return strings.TrimSpace(output.String()), nil
}

func (p *composeProject) validateConfiguration() error {
	if !composeProjectPattern.MatchString(p.name) || p.config.Name != p.name {
		return errors.New("Compose project name is not isolated")
	}
	for _, service := range []string{"db", "redis", "collaboration", "api", "web", "migrate"} {
		if _, ok := p.config.Services[service]; !ok {
			return fmt.Errorf("Compose service %s is missing", service)
		}
	}
	for name, service := range p.config.Services {
		if service.ContainerName != "" {
			return errors.New("Compose acceptance refuses globally named containers")
		}
		if name != "web" && len(service.Ports) != 0 {
			return errors.New("Compose exposes a private dependency or API port")
		}
		for _, mount := range service.Volumes {
			if mount.Type != "volume" {
				return errors.New("Compose acceptance refuses host bind mounts")
			}
		}
	}
	web := p.config.Services["web"]
	if len(web.Ports) != 1 || web.Ports[0].HostIP != "127.0.0.1" || web.Ports[0].Target != 80 || web.Ports[0].Published != "0" {
		return errors.New("Compose frontend must use an isolated loopback port")
	}
	if p.config.Services["api"].Image != p.backend || p.config.Services["migrate"].Image != p.backend || web.Image != p.frontend {
		return errors.New("Compose did not use the selected local images")
	}
	engine := p.config.Services["collaboration"]
	if engine.Image != p.collaboration || p.config.Services["api"].Environment["ORBIS_COLLABORATION_URL"] != "http://collaboration:9203" ||
		len(engine.Environment["ORBIS_COLLABORATION_KEY"]) < 32 || engine.Environment["ORBIS_COLLABORATION_KEY"] != p.config.Services["api"].Environment["ORBIS_COLLABORATION_KEY"] {
		return errors.New("Compose collaboration engine image, private origin or independent credentials do not match")
	}
	if !p.config.Services["migrate"].Healthcheck.Disable {
		return errors.New("Compose migration must disable the server HTTP healthcheck")
	}
	dsn := p.config.Services["api"].Environment["ORBIS_DATABASE_URL"]
	u, err := url.Parse(dsn)
	if err != nil || u.User == nil || u.Scheme != "postgres" || u.User.Username() != "orbis" || u.Host != "db:5432" || u.Path != "/orbis" {
		return errors.New("Compose did not derive the isolated internal PostgreSQL connection")
	}
	password, _ := u.User.Password()
	if password != p.password || p.config.Services["db"].Environment["POSTGRES_PASSWORD"] != p.password || p.config.Services["migrate"].Environment["ORBIS_DATABASE_URL"] != dsn {
		return errors.New("Compose database and migration credentials do not match")
	}
	for key, volume := range p.config.Volumes {
		if volume.External || volume.Name != p.name+"_"+key {
			return errors.New("Compose acceptance refuses shared or external volumes")
		}
	}
	for key, network := range p.config.Networks {
		if network.External || network.Name != p.name+"_"+key {
			return errors.New("Compose acceptance refuses shared or external networks")
		}
	}
	if _, err := p.privateVolume(); err != nil {
		return err
	}
	return nil
}

func (p *composeProject) configurationMatrix(ctx context.Context) error {
	defaults := p.config.Services["api"].Environment
	if defaults["ORBIS_MAX_BODY_BYTES"] != "8388608" || defaults["ORBIS_MAX_UPLOAD_BYTES"] != "33554432" {
		return errors.New("Compose default request or upload limits do not match the product defaults")
	}
	password := randomID() + "@:/?#%$+ !"
	escaped := strings.ReplaceAll(url.QueryEscape(password), "+", "%20")
	explicit := "postgres://matrix_user:" + escaped + "@database.example.invalid:5543/matrix_db?sslmode=verify-full"
	matrix := *p
	matrix.envFile = filepath.Join(p.runtime, "matrix.env")
	values := append(slices.Clone(p.environment), "ORBIS_DATABASE_URL="+explicit, "ORBIS_MAX_BODY_BYTES=2097152", "ORBIS_MAX_UPLOAD_BYTES=1048576")
	if err := writeEnvironment(matrix.envFile, values); err != nil {
		return err
	}
	configured, err := matrix.invoke(ctx, false, "--profile", "maintenance", "config", "--format", "json")
	if err != nil {
		return errors.New("resolve explicit database URL and request-limit Compose configuration")
	}
	var configuration composeConfig
	if json.Unmarshal([]byte(configured), &configuration) != nil {
		return errors.New("decode Compose configuration matrix")
	}
	api := configuration.Services["api"].Environment
	if api["ORBIS_DATABASE_URL"] != explicit {
		return errors.New("Compose did not preserve the explicit API database URL")
	}
	if configuration.Services["migrate"].Environment["ORBIS_DATABASE_URL"] != explicit {
		return errors.New("Compose did not preserve the explicit migration database URL")
	}
	if api["ORBIS_MAX_BODY_BYTES"] != "2097152" || api["ORBIS_MAX_UPLOAD_BYTES"] != "1048576" {
		return errors.New("Compose did not preserve request/upload limit overrides")
	}
	return nil
}

func (p *composeProject) privateVolume() (string, error) {
	for _, mount := range p.config.Services["api"].Volumes {
		if mount.Target == "/data" && mount.Type == "volume" {
			if volume, ok := p.config.Volumes[mount.Source]; ok && volume.Name != "" {
				return volume.Name, nil
			}
		}
	}
	return "", errors.New("Compose API has no private persistent data volume")
}

func (p *composeProject) up(ctx context.Context, services ...string) error {
	_, err := p.invoke(ctx, true, append([]string{"up", "--detach", "--wait", "--wait-timeout", "90"}, services...)...)
	if err != nil {
		return fmt.Errorf("start healthy Compose services %s: %w", strings.Join(services, "/"), err)
	}
	return nil
}

func (p *composeProject) migrate(ctx context.Context) error {
	_, err := p.invoke(ctx, true, "--profile", "maintenance", "run", "--rm", "migrate")
	if err != nil {
		return fmt.Errorf("explicit Compose migration: %w", err)
	}
	return nil
}

func (p *composeProject) database(ctx context.Context, query string) (string, error) {
	return p.invoke(ctx, false, "exec", "-T", "db", "psql", "-U", "orbis", "-d", "orbis", "-Atc", query)
}

func (p *composeProject) schema(ctx context.Context) (string, error) {
	version, err := p.database(ctx, "SELECT version::text || ':' || dirty::text FROM schema_migrations")
	if err != nil || !regexp.MustCompile(`^[1-9][0-9]*:false$`).MatchString(version) {
		return "", errors.New("Compose database schema was not migrated cleanly")
	}
	users, err := p.database(ctx, "SELECT count(*) FROM users")
	if err != nil || users != "0" {
		return "", errors.New("Compose unexpectedly initialized an application account")
	}
	return version, nil
}

func (p *composeProject) frontendProbe(ctx context.Context) error {
	ids, err := p.invoke(ctx, false, "ps", "--quiet", "web")
	if err != nil || len(strings.Fields(ids)) != 1 {
		return errors.New("Compose frontend container was not uniquely identified")
	}
	port, err := publishedPort(ctx, ids, "80/tcp")
	if err != nil {
		return err
	}
	w := &frontendSmoke{origin: "http://127.0.0.1:" + port, probe: "capability-" + randomID()}
	// HTTP checks are shared with image smoke; the Compose test owns no extra network.
	if err := w.verifyHTTP(ctx); err != nil {
		return err
	}
	return p.collaborationProbe(ctx, w.origin)
}

func (p *composeProject) collaborationProbe(ctx context.Context, origin string) error {
	if _, err := p.invoke(ctx, false, "exec", "-T", "collaboration", "node", "-e", "fetch('http://127.0.0.1:9203/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"); err != nil {
		return errors.New("Compose collaboration runtime is not healthy")
	}
	// Upgrade and first-frame rejection need no account or existing document.
	// This verifies the deployed Nginx route and keeps credential probes out of URLs.
	bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	path := "/api/v1/workspaces/" + uuid.NewString() + "/documents/" + uuid.NewString() + "/collaboration/socket"
	conn, _, err := websocket.Dial(bounded, "ws"+strings.TrimPrefix(origin, "http")+path, &websocket.DialOptions{
		Subprotocols: []string{"orbis.crdt.v1"},
	})
	if err != nil {
		return errors.New("Compose Nginx did not forward the collaboration WebSocket upgrade")
	}
	defer conn.CloseNow()
	if conn.Subprotocol() != "orbis.crdt.v1" {
		return errors.New("Compose collaboration WebSocket did not preserve its subprotocol")
	}
	if err := wsjson.Write(bounded, conn, map[string]any{"type": "authenticate", "protocol_version": 1, "token": "disposable-invalid-token", "after_version": 0}); err != nil {
		return errors.New("write the owned collaboration authentication probe")
	}
	var response struct {
		Type, Code string
		Status     int
	}
	if err := wsjson.Read(bounded, conn, &response); err != nil || response.Type != "error" || response.Status != 401 || response.Code == "" {
		return errors.New("Compose WebSocket did not reject an invalid first-frame credential")
	}
	return nil
}

func (p *composeProject) privateFile(ctx context.Context, marker, value string, write bool) error {
	volume, err := p.privateVolume()
	if err != nil {
		return err
	}
	labels, err := docker(ctx, "volume", "inspect", volume, "--format", "{{json .Labels}}")
	var actual map[string]string
	if err != nil || json.Unmarshal([]byte(labels), &actual) != nil || p.validateOwnership([]composeResource{{Name: volume, Kind: "volume", Labels: actual}}) != nil {
		return errors.New("refuse mounting an unverified private Compose volume")
	}
	if !regexp.MustCompile(`^[a-f0-9]{32}$`).MatchString(marker) || !regexp.MustCompile(`^[a-f0-9]{32}$`).MatchString(value) {
		return errors.New("private file probe has an invalid test marker")
	}
	script := `cat "/data/objects/.testenv-` + marker + `"`
	if write {
		script = `umask 077; printf '%s' '` + value + `' > "/data/objects/.testenv-` + marker + `"`
	}
	// The official PostgreSQL image is already present; use its shell as the API UID.
	// The product server image deliberately contains no shell or test executable.
	args := []string{"run", "--rm", "--name", p.name + "_file_probe", "--label", composeProjectLabel + "=" + p.name, "--label", "com.docker.compose.service=testenv-file-probe", "--label", resourceLabel, "--network", "none", "--user", "65532:65532", "--mount", "type=volume,source=" + volume + ",target=/data", "--entrypoint", "sh", p.config.Services["db"].Image, "-c", script}
	output, err := dockerCreate(ctx, args...)
	if err != nil || (!write && output != value) {
		return errors.New("Compose private volume was not writable or did not retain its bytes for the API UID")
	}
	return nil
}

func (p *composeProject) accept(ctx context.Context) error {
	fmt.Println("Compose: checking installation and HTTP delivery.")
	if err := p.up(ctx, "db", "redis"); err != nil {
		return err
	}
	if err := p.migrate(ctx); err != nil {
		return err
	}
	if err := p.up(ctx, "api", "web"); err != nil {
		return err
	}
	if err := p.frontendProbe(ctx); err != nil {
		return err
	}
	version, err := p.schema(ctx)
	if err != nil {
		return err
	}
	marker, value := randomID(), randomID()
	query := "CREATE TABLE orbis_test_deployment_sentinel (id text PRIMARY KEY, value text NOT NULL); INSERT INTO orbis_test_deployment_sentinel VALUES ('" + marker + "','" + value + "')"
	if _, err := p.database(ctx, query); err != nil {
		return errors.New("write isolated PostgreSQL persistence marker")
	}
	if output, err := p.invoke(ctx, false, "exec", "-T", "redis", "redis-cli", "SET", "orbis:testenv:"+marker, value); err != nil || output != "OK" {
		return errors.New("write isolated Redis persistence marker")
	}
	if err := p.privateFile(ctx, marker, value, true); err != nil {
		return err
	}
	fmt.Println("Compose: recreating the entire project while retaining volumes.")
	if _, err := p.invoke(ctx, true, "down", "--timeout", "20"); err != nil {
		return errors.New("stop isolated Compose project without deleting volumes")
	}
	if err := p.up(ctx, "db", "redis"); err != nil {
		return err
	}
	if err := p.verifyPersistence(ctx, version, marker, value); err != nil {
		return err
	}
	if err := p.migrate(ctx); err != nil {
		return err
	}
	if err := p.up(ctx, "api", "web"); err != nil {
		return err
	}
	if err := p.frontendProbe(ctx); err != nil {
		return err
	}
	fmt.Println("Compose: checking maintenance and an explicit upgrade cycle.")
	if _, err := p.invoke(ctx, true, "stop", "--timeout", "30", "web", "api"); err != nil {
		return errors.New("stop API and frontend before maintenance")
	}
	for _, maintenance := range []string{"gc-assets", "gc-imports"} {
		if _, err := p.invoke(ctx, true, "run", "--rm", "--no-deps", "api", maintenance); err != nil {
			return fmt.Errorf("Compose %s maintenance failed", maintenance)
		}
	}
	if err := p.migrate(ctx); err != nil {
		return err
	}
	if err := p.up(ctx, "api", "web"); err != nil {
		return err
	}
	if err := p.verifyPersistence(ctx, version, marker, value); err != nil {
		return err
	}
	return p.frontendProbe(ctx)
}

func (p *composeProject) verifyPersistence(ctx context.Context, version, marker, value string) error {
	current, err := p.schema(ctx)
	if err != nil || current != version {
		return errors.New("Compose did not retain the installed schema")
	}
	row, err := p.database(ctx, "SELECT value FROM orbis_test_deployment_sentinel WHERE id='"+marker+"'")
	if err != nil || row != value {
		return errors.New("Compose PostgreSQL volume did not retain its test row")
	}
	row, err = p.invoke(ctx, false, "exec", "-T", "redis", "redis-cli", "GET", "orbis:testenv:"+marker)
	if err != nil || row != value {
		return errors.New("Compose Redis volume did not retain its test key")
	}
	return p.privateFile(ctx, marker, value, false)
}

type composeResource struct {
	Name, Kind string
	Labels     map[string]string
}

func (p *composeProject) resources(ctx context.Context) ([]composeResource, error) {
	var resources []composeResource
	for _, kind := range []string{"container", "network", "volume"} {
		args := []string{kind, "ls", "--quiet", "--filter", "label=" + composeProjectLabel + "=" + p.name}
		if kind == "container" {
			args = append(args, "--all")
		}
		listed, err := docker(ctx, args...)
		if err != nil {
			return nil, errors.New("enumerate owned Compose resources")
		}
		if listed == "" {
			continue
		}
		inspected, err := docker(ctx, append([]string{kind, "inspect"}, strings.Fields(listed)...)...)
		if err != nil {
			return nil, errors.New("inspect owned Compose resources")
		}
		var values []struct {
			Name   string
			Labels map[string]string
			Config struct{ Labels map[string]string }
		}
		if err := json.Unmarshal([]byte(inspected), &values); err != nil {
			return nil, errors.New("decode owned Compose resource labels")
		}
		for _, value := range values {
			labels := value.Labels
			if kind == "container" {
				labels = value.Config.Labels
			}
			resources = append(resources, composeResource{strings.TrimPrefix(value.Name, "/"), kind, labels})
		}
	}
	return resources, nil
}

func (p *composeProject) validateOwnership(resources []composeResource) error {
	if !p.registered || !composeProjectPattern.MatchString(p.name) {
		return errors.New("refuse cleanup of an unregistered Compose project")
	}
	for _, resource := range resources {
		if resource.Labels[composeProjectLabel] != p.name {
			return errors.New("refuse cleanup of a foreign Compose resource")
		}
		switch resource.Kind {
		case "container":
			service := resource.Labels["com.docker.compose.service"]
			if _, ok := p.config.Services[service]; !ok && !(service == "testenv-file-probe" && resource.Name == p.name+"_file_probe") {
				return errors.New("refuse cleanup of an unexpected Compose container")
			}
			if !strings.HasPrefix(resource.Name, p.name+"-") && resource.Name != p.name+"_file_probe" {
				return errors.New("refuse cleanup of a globally named container")
			}
		case "volume":
			key := resource.Labels["com.docker.compose.volume"]
			if volume, ok := p.config.Volumes[key]; !ok || volume.Name != resource.Name {
				return errors.New("refuse cleanup of an unexpected Compose volume")
			}
		case "network":
			key := resource.Labels["com.docker.compose.network"]
			if network, ok := p.config.Networks[key]; !ok || network.Name != resource.Name {
				return errors.New("refuse cleanup of an unexpected Compose network")
			}
		default:
			return errors.New("refuse cleanup of an unknown resource type")
		}
	}
	return nil
}

func (p *composeProject) close() error {
	if !p.registered || !p.attempted {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	resources, err := p.resources(ctx)
	if err != nil {
		return err
	}
	if len(resources) == 0 {
		return nil
	}
	if err := p.validateOwnership(resources); err != nil {
		return err
	}
	for _, resource := range resources {
		if resource.Kind == "container" && resource.Name == p.name+"_file_probe" {
			if _, err := docker(ctx, "rm", "--force", resource.Name); err != nil {
				return errors.New("remove the verified private-file probe before deleting its volume")
			}
		}
	}
	if _, err := p.invoke(ctx, true, "down", "--volumes", "--remove-orphans", "--timeout", "20"); err != nil {
		return fmt.Errorf("clean up owned Compose project %s: %w", p.name, err)
	}
	resources, err = p.resources(ctx)
	if err != nil || len(resources) != 0 {
		return fmt.Errorf("owned Compose project %s retained resources after cleanup", p.name)
	}
	fmt.Println("Compose project containers, network, and volumes removed:", p.name)
	return nil
}
