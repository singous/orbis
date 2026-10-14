#!/bin/sh
set -eu

cd /workspace
rm -f /tmp/orbis-dev-ready

if [ ! -f uv.lock ]; then
    printf '%s\n' 'Missing uv.lock. Run make lock to create the workspace lockfile.' >&2
    exit 1
fi

# Include every workspace member; uv sync alone only installs the root project.
# --locked rejects dependency drift instead of changing the lockfile on startup.
uv sync --locked --all-packages --group dev
touch /tmp/orbis-dev-ready

exec "$@"
