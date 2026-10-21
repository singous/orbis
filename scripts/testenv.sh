#!/bin/sh
set -eu

orbis_testenv_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
orbis_testenv_bin="$orbis_testenv_root/.dev/bin"
mkdir -p "$orbis_testenv_bin"
orbis_testenv_build=$(mktemp -d "$orbis_testenv_bin/.testenv-build-XXXXXXXX")
trap 'rm -rf -- "$orbis_testenv_build"' 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

GOTMPDIR="${GOTMPDIR:-$orbis_testenv_build}" \
    sh "$orbis_testenv_root/scripts/go.sh" build -trimpath -buildvcs=false \
    -o "$orbis_testenv_build/testenv" ./tools/testenv
# The executable is owned by this invocation, including on filesystems with inherited ACLs.
chmod 755 "$orbis_testenv_build/testenv"
mv -f -- "$orbis_testenv_build/testenv" "$orbis_testenv_bin/testenv"
rmdir -- "$orbis_testenv_build"
trap - 0 HUP INT TERM

# Playwright and CI must signal the resource owner directly, without a go run parent.
exec "$orbis_testenv_bin/testenv" "$@"
