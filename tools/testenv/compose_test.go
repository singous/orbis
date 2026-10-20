package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
)

func composeFixture(t *testing.T) *composeProject {
	t.Helper()
	p := &composeProject{name: "orbis_compose_" + strings.Repeat("a", 32), backend: "sha256:backend", frontend: "sha256:frontend", collaboration: "sha256:collaboration", password: "isolated-test-password"}
	data := fmt.Sprintf(`{
		"name": %q,
		"services": {
			"db": {"image":"postgres", "environment":{"POSTGRES_PASSWORD":%q}},
			"redis": {"image":"redis"},
			"api": {"image":%q, "environment":{"ORBIS_DATABASE_URL":%q}, "volumes":[{"type":"volume","source":"private-data","target":"/data"}]},
			"web": {"image":%q, "ports":[{"host_ip":"127.0.0.1","published":"0","target":80}]},
			"migrate": {"image":%q, "healthcheck":{"disable":true}, "environment":{"ORBIS_DATABASE_URL":%q}}
		},
		"volumes":{"private-data":{"name":%q}},
		"networks":{"default":{"name":%q}}
	}`, p.name, p.password, p.backend, "postgres://orbis:"+p.password+"@db:5432/orbis?sslmode=disable", p.frontend, p.backend, "postgres://orbis:"+p.password+"@db:5432/orbis?sslmode=disable", p.name+"_private-data", p.name+"_default")
	if err := json.Unmarshal([]byte(data), &p.config); err != nil {
		t.Fatal(err)
	}
	p.config.Services["collaboration"] = composeService{Image: p.collaboration, Environment: map[string]string{"ORBIS_COLLABORATION_KEY": strings.Repeat("c", 64)}}
	p.config.Services["api"].Environment["ORBIS_COLLABORATION_URL"] = "http://collaboration:9203"
	p.config.Services["api"].Environment["ORBIS_COLLABORATION_KEY"] = strings.Repeat("c", 64)
	return p
}

func TestComposeConfigurationRejectsSharedOrExposedResources(t *testing.T) {
	if err := composeFixture(t).validateConfiguration(); err != nil {
		t.Fatalf("isolated deployment rejected: %v", err)
	}
	cases := map[string]func(*composeProject){
		"external volume": func(p *composeProject) {
			volume := p.config.Volumes["private-data"]
			volume.External = true
			p.config.Volumes["private-data"] = volume
		},
		"foreign volume name": func(p *composeProject) {
			p.config.Volumes["private-data"] = composeVolume{Name: "existing-installation-data"}
		},
		"foreign network": func(p *composeProject) {
			p.config.Networks["default"] = composeNetwork{Name: "shared-network", External: true}
		},
		"host filesystem mount": func(p *composeProject) {
			api := p.config.Services["api"]
			api.Volumes[0].Type = "bind"
			p.config.Services["api"] = api
		},
		"global container name": func(p *composeProject) {
			api := p.config.Services["api"]
			api.ContainerName = "existing-api"
			p.config.Services["api"] = api
		},
		"private API port": func(p *composeProject) {
			api := p.config.Services["api"]
			api.Ports = p.config.Services["web"].Ports
			p.config.Services["api"] = api
		},
		"database password mismatch": func(p *composeProject) {
			p.config.Services["db"].Environment["POSTGRES_PASSWORD"] = "different-synthetic-password"
		},
		"collaboration key mismatch": func(p *composeProject) {
			p.config.Services["collaboration"].Environment["ORBIS_COLLABORATION_KEY"] = strings.Repeat("x", 64)
		},
		"external collaboration service": func(p *composeProject) {
			p.config.Services["api"].Environment["ORBIS_COLLABORATION_URL"] = "http://shared-service.example.test"
		},
		"migration connection mismatch": func(p *composeProject) {
			p.config.Services["migrate"].Environment["ORBIS_DATABASE_URL"] = "postgres://other/database"
		},
		"inherited migration HTTP healthcheck": func(p *composeProject) {
			migration := p.config.Services["migrate"]
			migration.Healthcheck.Disable = false
			p.config.Services["migrate"] = migration
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			p := composeFixture(t)
			mutate(p)
			if err := p.validateConfiguration(); err == nil {
				t.Fatal("unsafe deployment configuration was accepted")
			}
		})
	}
}

func TestComposeCleanupRequiresRegisteredNamesAndResourceLabels(t *testing.T) {
	p := composeFixture(t)
	resources := []composeResource{
		{Name: p.name + "-api-1", Kind: "container", Labels: map[string]string{composeProjectLabel: p.name, "com.docker.compose.service": "api"}},
		{Name: p.name + "_private-data", Kind: "volume", Labels: map[string]string{composeProjectLabel: p.name, "com.docker.compose.volume": "private-data"}},
		{Name: p.name + "_default", Kind: "network", Labels: map[string]string{composeProjectLabel: p.name, "com.docker.compose.network": "default"}},
	}
	if err := p.validateOwnership(resources); err == nil {
		t.Fatal("unregistered project cleanup was allowed")
	}
	p.registered = true
	if err := p.validateOwnership(resources); err != nil {
		t.Fatalf("owned resources rejected: %v", err)
	}
	resources[0].Labels[composeProjectLabel] = "daily-installation"
	if err := p.validateOwnership(resources); err == nil {
		t.Fatal("foreign project label was accepted")
	}
	resources[0].Labels[composeProjectLabel] = p.name
	resources[1].Name = "daily-installation-data"
	if err := p.validateOwnership(resources); err == nil {
		t.Fatal("foreign volume name was accepted")
	}
	resources[1].Name = p.name + "_private-data"
	resources[0].Name = "globally-named-api"
	if err := p.validateOwnership(resources); err == nil {
		t.Fatal("global container name was accepted")
	}
}

func TestComposeDoesNotDispatchUnregisteredOrCanceledMutation(t *testing.T) {
	p := composeFixture(t)
	if _, err := p.invoke(t.Context(), true, "up"); err == nil || p.attempted {
		t.Fatal("unregistered mutation reached Docker")
	}
	p.registered = true
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := p.invoke(ctx, true, "up"); !errors.Is(err, context.Canceled) || p.attempted {
		t.Fatal("canceled owner dispatched another Docker mutation")
	}
}

func TestComposeIgnoresAmbientDeploymentAndComposeFiles(t *testing.T) {
	t.Setenv("ORBIS_DATABASE_URL", "postgres://synthetic-credential@shared/database")
	t.Setenv("COMPOSE_FILE", "/deployment/compose.yaml")
	t.Setenv("COMPOSE_ENV_FILES", "/deployment/.env")
	t.Setenv("COMPOSE_PROJECT_NAME", "daily-installation")
	t.Setenv("COMPOSE_PROFILES", "unrelated-service")
	for _, value := range composeEnvironment() {
		if strings.HasPrefix(value, "COMPOSE_") || (strings.HasPrefix(value, "ORBIS_") && !strings.HasPrefix(value, "ORBIS_GO_BIN=")) {
			t.Fatalf("ambient deployment configuration reached Compose: %s", strings.SplitN(value, "=", 2)[0])
		}
	}
	if os.Getenv("COMPOSE_PROJECT_NAME") != "daily-installation" {
		t.Fatal("test launcher changed the caller environment")
	}
}
