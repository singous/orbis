#!/bin/sh
set -eu
orbis_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$orbis_root"
mkdir -p bin
orbis_stage=$(mktemp -d "$orbis_root/bin/.build-XXXXXX")
trap 'rm -rf "$orbis_stage"' EXIT HUP INT TERM
mkdir -p "$orbis_stage/tmp"
export GOTMPDIR="${GOTMPDIR:-$orbis_stage/tmp}"
sh scripts/go.sh build -trimpath -buildvcs=false \
    -ldflags="-s -w -X main.version=${ORBIS_VERSION:-0.1.1}" \
    -o "$orbis_stage/orbis-server" ./cmd/server
install -m 755 "$orbis_stage/orbis-server" bin/orbis-server
