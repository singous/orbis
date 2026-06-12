# Orbis

Orbis monorepo workspace for Python-based microservices and related frontend
applications.

## Getting Started

This repository is initialized with service placeholders and repository-level
Python tooling conventions. Service-specific application skeletons, dependency
files, and runtime configuration will be added as each service takes shape.

## Repository Structure

```text
.
|-- orbis-gateway/             # Gateway behind nginx, in front of backend services
|-- orbis-user-api/            # Backend user API service
|-- orbis-user-web/            # Frontend user web application
|-- orbis-omni-processor/      # Multimodal data processing service
|-- orbis-indexer/             # Data write/indexing service
|-- orbis-statistic-offline/   # Offline task service
|-- orbis-retrievaler/         # External retrieval service
|-- orbis-data-receiver/       # External data reporting receiver service
|-- .editorconfig
|-- .gitignore
|-- .python-version
|-- pyproject.toml
`-- README.md
```

Each service directory currently contains a `.gitkeep` placeholder and a
minimal `pyproject.toml` for uv workspace membership. Application scaffolds,
dependencies, and runtime configuration have not been added yet.

## Development

Python is pinned to the 3.12 minor line:

```bash
uv python install 3.12
uv sync
uv run python --version
```

The root `pyproject.toml` is configured for uv with `package = false`, so the
repository root acts as a tooling entrypoint rather than an installable Python
package.

`[tool.uv.workspace]` is enabled with explicit members for each service
directory. Each service is also configured with `package = false` until its
application layout is introduced.
