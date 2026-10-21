.DEFAULT_GOAL := help
export BUILDX_CONFIG := $(CURDIR)/.dev/buildx
NPM ?= npm
GO := sh scripts/go.sh

.PHONY: help build check test format backend-build backend-check backend-test backend-run backend-migrate cli-build cli-check cli-test frontend-install frontend-check frontend-test frontend-build frontend-e2e collaboration-install collaboration-build collaboration-check collaboration-test integration smoke compose-check go-build go-check go-test go-run go-migrate go-integration web-check web-test web-build web-e2e

help:
	@printf '%s\n' \
	  'make build            Build server, independent CLI and frontend' \
	  'make check            Format/vet/unit/contracts, CLI and frontend checks' \
	  'make test             Run backend, CLI and frontend unit tests' \
	  'make format           Format both Go modules' \
	  'make backend-run      Start the server using explicit ORBIS_* configuration' \
	  'make backend-migrate  Explicitly migrate ORBIS_DATABASE_URL' \
	  'make cli-build        Build the independent Go CLI to bin/orbis' \
	  'make frontend-install Install locked frontend dependencies' \
	  'make frontend-build   Build the frontend' \
	  'make frontend-e2e     Run browser acceptance in an owned Go test environment' \
	  'make collaboration-install Install locked collaboration engine dependencies' \
	  'make collaboration-check   Check engine types, CRDT persistence and HTTP lifecycle' \
	  'make integration      Run PostgreSQL/Redis tests; TEST_ARGS="-race -v" enables race checks' \
	  'make smoke            Verify IMAGE=server image and optional FRONTEND_IMAGE=frontend image' \
	  'make compose-check    Verify Compose with IMAGE, FRONTEND_IMAGE and COLLABORATION_IMAGE'

build: backend-build cli-build frontend-build collaboration-build
check: backend-check cli-check frontend-check collaboration-check
test: backend-test cli-test frontend-test collaboration-test
format:
	sh scripts/check-go-format.sh --write

backend-build:
	sh scripts/build-go.sh
backend-test:
	GIN_MODE=release $(GO) test ./...
backend-check:
	sh scripts/check-go-format.sh backend
	$(GO) vet ./...
	GIN_MODE=release $(GO) test ./...
backend-run:
	$(GO) run ./cmd/server serve
backend-migrate:
	$(GO) run ./cmd/server migrate

cli-build:
	sh scripts/build-cli.sh
cli-test:
	$(GO) -C cli test ./...
cli-check:
	sh scripts/check-go-format.sh cli
	$(GO) -C cli vet ./...
	$(GO) -C cli test ./...

frontend-install:
	$(NPM) --prefix frontend ci --no-audit --no-fund
frontend-test:
	$(NPM) --prefix frontend run test:run -- --maxWorkers=2
frontend-check: frontend-test
	$(NPM) --prefix frontend run check:document-blocks
	$(NPM) --prefix frontend run typecheck
frontend-build:
	$(NPM) --prefix frontend run build
frontend-e2e:
	$(NPM) --prefix frontend run test:e2e

collaboration-install:
	$(NPM) --prefix collaboration ci --no-audit --no-fund
collaboration-build:
	$(NPM) --prefix collaboration run build
collaboration-check: collaboration-test
collaboration-test:
	$(NPM) --prefix collaboration test

integration:
	sh scripts/testenv.sh integration $(TEST_ARGS) $(GO_TEST_ARGS)
smoke:
	$(if $(strip $(IMAGE)),,$(error Set IMAGE to a locally built server image))
	sh scripts/testenv.sh smoke --backend-image "$(IMAGE)" $(if $(strip $(FRONTEND_IMAGE)),--frontend-image "$(FRONTEND_IMAGE)",)

compose-check:
	$(if $(strip $(IMAGE)),,$(error Set IMAGE to a locally built server image))
	$(if $(strip $(FRONTEND_IMAGE)),,$(error Set FRONTEND_IMAGE to a locally built frontend image))
	$(if $(strip $(COLLABORATION_IMAGE)),,$(error Set COLLABORATION_IMAGE to a locally built collaboration image))
	sh scripts/testenv.sh compose --backend-image "$(IMAGE)" --frontend-image "$(FRONTEND_IMAGE)" --collaboration-image "$(COLLABORATION_IMAGE)"

go-build: backend-build
go-check: backend-check
go-test: backend-test
go-run: backend-run
go-migrate: backend-migrate
go-integration: integration
web-check: frontend-check
web-test: frontend-test
web-build: frontend-build
web-e2e: frontend-e2e
