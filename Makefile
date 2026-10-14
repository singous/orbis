.DEFAULT_GOAL := help

# Keep Buildx metadata in the workspace.
export BUILDX_CONFIG := $(CURDIR)/.dev/buildx
COMPOSE := docker compose
RUN := $(COMPOSE) run --rm -T dev

.PHONY: help init setup dev sync shell run uv lock lint format format-check test check doctor status logs down

help:
	@printf '%s\n' \
	  'make setup        Build the development image and install locked dependencies' \
	  'make dev          Start the development container and wait until ready' \
	  'make shell        Open a disposable development shell' \
	  'make run ARGS="python --version"  Run a command in the development container' \
	  'make uv ARGS="add --package orbis-user-api httpx"  Change dependencies' \
	  'make sync         Install the dependencies recorded in uv.lock' \
	  'make lock         Update uv.lock after editing pyproject.toml' \
	  'make check        Check Compose, lockfile and shell syntax' \
	  'make test         Run pytest (no tests collected is an error)' \
	  'make format       Format Python source with Ruff' \
	  'make doctor       Show tool versions and check installed dependencies' \
	  'make status       Show development containers' \
	  'make logs         Follow development container logs' \
	  'make down         Remove development containers; keep local data and cache'

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
	$(RUN) sh -ec 'uv lock --check; for file in scripts/*.sh docker/dev/*.sh; do sh -n "$$file"; done'

doctor: init
	$(COMPOSE) config --quiet
	$(RUN) sh -ec 'id; python --version; uv --version; ruff --version; pytest --version; uv pip check'

status:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs --tail=100 -f dev

down:
	$(COMPOSE) down
