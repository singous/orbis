.DEFAULT_GOAL := help

# Keep Buildx metadata local, including on NAS hosts with restrictive home ACLs.
export BUILDX_CONFIG := $(CURDIR)/.dev/buildx
COMPOSE := docker compose
RUN := $(COMPOSE) run --rm -T dev
APP_RUNTIME ?= /vol1/1000/Deploy/internal/orbis-dev

.PHONY: help init setup dev sync shell run uv lock lint format format-check test check doctor status logs down app-status app-up app-logs rollback

help:
	@printf '%s\n' \
	  'make setup        Build the development image and install locked dependencies' \
	  'make dev          Start the development container and wait until ready' \
	  'make shell        Open a disposable development shell' \
	  'make run ARGS="python --version"  Run a command in the development container' \
	  'make uv ARGS="add --package orbis-user-api httpx"  Change dependencies' \
	  'make sync         Install the dependencies recorded in uv.lock' \
	  'make lock         Update uv.lock after editing pyproject.toml' \
	  'make check        Check Compose, lockfile, lint, formatting and shell syntax' \
	  'make test         Run pytest (no tests collected is an error)' \
	  'make format       Format Python source with Ruff' \
	  'make doctor       Show tool versions and check installed dependencies' \
	  'make status       Show development containers' \
	  'make logs         Follow development container logs' \
	  'make down         Remove development containers; keep local data and cache'
	@printf '%s\n' \
	  'make app-status   Show the current Jenkins release' \
	  'make app-up       Start the current application release with Compose' \
	  'make app-logs     Follow application logs' \
	  'make rollback RELEASE=<release-id>  Restore a retained release'

init:
	@sh scripts/init-dev.sh

setup: init
	$(COMPOSE) build dev
	$(RUN) python --version

dev: init
	$(COMPOSE) up -d --build --wait --wait-timeout 180 dev

sync: init
	$(RUN) true

shell: init
	$(COMPOSE) run --rm dev bash

run: init
	$(if $(strip $(ARGS)),,$(error Set ARGS, for example ARGS="python --version"))
	$(RUN) $(ARGS)

# Bypass locked startup sync so dependency edits can repair an out-of-date lock.
uv: init
	$(COMPOSE) run --rm -T --entrypoint uv dev $(ARGS)

lock: init
	$(COMPOSE) run --rm -T --entrypoint uv dev lock

lint: init
	$(RUN) uv run --no-sync ruff check .

format: init
	$(RUN) uv run --no-sync ruff format .

format-check: init
	$(RUN) uv run --no-sync ruff format --check .

test: init
	$(RUN) uv run --no-sync pytest $(PYTEST_ARGS)

check: init
	$(COMPOSE) config --quiet
	$(RUN) sh -ec 'uv lock --check; uv run --no-sync ruff check ci tests/deployment; uv run --no-sync ruff format --check ci tests/deployment; for file in scripts/*.sh docker/dev/*.sh ops/jenkins/*.sh; do sh -n "$$file"; done'

doctor: init
	$(COMPOSE) config --quiet
	$(RUN) sh -ec 'id; python --version; uv --version; ruff --version; pytest --version; uv pip check'

status:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs --tail=100 -f dev

down:
	$(COMPOSE) down

app-status:
	python3 ci/release.py status --runtime-dir "$(APP_RUNTIME)"

app-up:
	python3 ci/release.py up --runtime-dir "$(APP_RUNTIME)"

app-logs:
	docker compose --project-directory "$(APP_RUNTIME)" --env-file "$(APP_RUNTIME)/.env" --env-file "$(APP_RUNTIME)/images.env" -p orbis-app -f "$(APP_RUNTIME)/docker-compose.yml" logs --tail=100 -f

rollback:
	$(if $(strip $(RELEASE)),,$(error Set RELEASE to a retained release identifier))
	python3 ci/release.py rollback --runtime-dir "$(APP_RUNTIME)" --release-id "$(RELEASE)"
