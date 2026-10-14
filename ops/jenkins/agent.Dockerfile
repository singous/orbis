FROM docker:28.5.2-cli@sha256:625d9431a9f54c5a2bc90f24f0e1c3d55b1349fd857dd85035f98c2c9acbdd4d AS docker
FROM jenkins/jenkins:2.580.1-jdk21@sha256:a660310e39ade10631f774bacd5219de767dfd08947ea5c32a739b5e5bb382c1
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
COPY --chmod=755 agent-entrypoint.sh /usr/local/bin/orbis-agent
USER jenkins
ENTRYPOINT ["orbis-agent"]
