FROM ghcr.io/astral-sh/uv:0.12.6@sha256:88bc6eb1ccd4b82efd0e1b530caffabddf50dc2bf612e66c14ea25b8ee8a4d3d AS uv

FROM python:3.12.15-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS dev

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential ca-certificates curl git make \
    && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /uvx /usr/local/bin/

ARG ORBIS_UID=1000
ARG ORBIS_GID=1000
RUN if ! getent group "${ORBIS_GID}" >/dev/null; then \
        groupadd --gid "${ORBIS_GID}" orbis; \
    fi \
    && useradd --uid "${ORBIS_UID}" --gid "${ORBIS_GID}" \
        --create-home --shell /bin/bash orbis

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/workspace/.dev/venv \
    UV_CACHE_DIR=/workspace/.dev/cache/uv \
    PATH="/workspace/.dev/venv/bin:${PATH}"

COPY --chmod=755 docker/dev/entrypoint.sh /usr/local/bin/orbis-dev-entrypoint

WORKDIR /workspace
USER orbis
ENTRYPOINT ["orbis-dev-entrypoint"]
CMD ["sleep", "infinity"]
