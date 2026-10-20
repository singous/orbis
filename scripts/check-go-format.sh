#!/bin/sh
set -eu
orbis_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$orbis_root"
orbis_goroot=$(sh scripts/go.sh env GOROOT)
orbis_write=false
if [ "${1:-}" = "--write" ]; then
    orbis_write=true
    shift
fi
case "${1:-all}" in
    backend) set -- cmd internal api migrations tests tools ;;
    cli) set -- cli ;;
    all) set -- cmd internal api migrations tests tools cli ;;
    *) printf '%s\n' 'Choose backend, cli, or all.' >&2; exit 2 ;;
esac
if [ "$orbis_write" = true ]; then
    exec "$orbis_goroot/bin/gofmt" -w "$@"
fi
orbis_unformatted=$("$orbis_goroot/bin/gofmt" -l "$@")
if [ -n "$orbis_unformatted" ]; then
    printf '%s\n' 'Go files need formatting:' "$orbis_unformatted" >&2
    exit 1
fi
