#!/bin/sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
    printf '%s\n' 'Docker is required. Install Docker Engine or Docker Desktop first.' >&2
    exit 1
fi
docker compose version >/dev/null
docker info --format '{{.ServerVersion}}' >/dev/null

orbis_uid=$(id -u)
orbis_gid=$(id -g)
if [ "$orbis_uid" = 0 ]; then
    printf '%s\n' 'Run setup as a regular user with Docker access, without sudo.' >&2
    exit 1
fi

# Keep any existing local settings, including future service credentials.
if [ ! -e .env ]; then
    (
        umask 077
        set -C
        sed -e "s/^ORBIS_UID=.*/ORBIS_UID=$orbis_uid/" \
            -e "s/^ORBIS_GID=.*/ORBIS_GID=$orbis_gid/" .env.example > .env
    )
    printf '%s\n' 'Created .env with the current user and group IDs.'
fi

mkdir -p .dev/buildx .dev/cache .dev/venv
