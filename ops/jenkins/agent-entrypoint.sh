#!/bin/sh
set -eu
while [ ! -s /run/orbis-bootstrap/agent-secret ]; do
    sleep 2
done
until curl --fail --silent http://controller:8080/jnlpJars/agent.jar -o /tmp/orbis-agent.jar; do
    sleep 2
done
exec java -jar /tmp/orbis-agent.jar \
    -url http://controller:8080/ -name orbis-builder \
    -secret @/run/orbis-bootstrap/agent-secret -webSocket \
    -workDir "$ORBIS_AGENT_WORKDIR"
