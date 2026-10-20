#!/bin/sh
set -eu
orbis_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$orbis_root"
mkdir -p bin
orbis_stage=$(mktemp -d "$orbis_root/bin/.cli-build-XXXXXX")
trap 'rm -rf "$orbis_stage"' EXIT HUP INT TERM
mkdir -p "$orbis_stage/tmp"
export GOTMPDIR="${GOTMPDIR:-$orbis_stage/tmp}"
sh scripts/go.sh -C cli build -trimpath -buildvcs=false -o "$orbis_stage/orbis" ./cmd/orbis
install -m 755 "$orbis_stage/orbis" bin/orbis
