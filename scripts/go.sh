#!/bin/sh
set -eu
orbis_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
orbis_version=$(cat "$orbis_root/.go-version")
if [ -n "${ORBIS_GO_BIN:-}" ]; then
    orbis_go=$ORBIS_GO_BIN
elif command -v go >/dev/null 2>&1; then
    orbis_go=$(command -v go)
else
    orbis_go="$orbis_root/.dev/toolchains/go$orbis_version/go/bin/go"
fi
if [ ! -x "$orbis_go" ]; then
    printf '%s\n' 'Install the Go version in .go-version or set ORBIS_GO_BIN.' >&2
    exit 1
fi
export GOTOOLCHAIN=local
if [ "$("$orbis_go" env GOVERSION)" != "go$orbis_version" ]; then
    printf 'This project requires Go %s. Set ORBIS_GO_BIN to that toolchain.\n' "$orbis_version" >&2
    exit 1
fi
export GOPATH="${GOPATH:-$orbis_root/.dev/go}"
export GOCACHE="${GOCACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/orbis/go-build}"
export GOTMPDIR="${GOTMPDIR:-${TMPDIR:-/tmp}}"
export GOMAXPROCS="${GOMAXPROCS:-2}"
export GOMEMLIMIT="${GOMEMLIMIT:-768MiB}"
mkdir -p "$GOCACHE" "$GOTMPDIR"
cd "$orbis_root"
exec "$orbis_go" "$@"
