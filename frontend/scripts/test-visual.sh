#!/bin/sh
set -eu

task_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
docker run --rm --init --platform linux/amd64 --ipc=host \
  --mount "type=bind,src=$task_root,dst=/work" \
  --mount type=volume,dst=/work/frontend/node_modules \
  --workdir /work/frontend \
  mcr.microsoft.com/playwright:v1.63.0-noble@sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7 \
  sh -c 'npm ci --no-audit --no-fund && npm run test:visual -- "$@"' -- "$@"
