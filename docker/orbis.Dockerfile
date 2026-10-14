FROM ghcr.io/astral-sh/uv:0.12.6@sha256:88bc6eb1ccd4b82efd0e1b530caffabddf50dc2bf612e66c14ea25b8ee8a4d3d AS uv

FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS frontend-source
WORKDIR /app/orbis-user-web
COPY --chmod=644 orbis-user-web/package.json orbis-user-web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY --chown=1000:1000 --chmod=755 orbis-user-web/ ./
COPY --chmod=755 orbis-user-api/src/orbis_user_api/domain/document_blocks.json /app/orbis-user-api/src/orbis_user_api/domain/document_blocks.json
RUN mkdir -p node_modules/.vite && chown 1000:1000 . node_modules/.vite

FROM frontend-source AS frontend-test
CMD ["npm", "run", "test:run"]

FROM frontend-source AS frontend-build
RUN npm run build

FROM python:3.12.15-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS backend-source
COPY --from=uv /uv /uvx /usr/local/bin/
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/opt/venv/bin:${PATH}"
WORKDIR /app
COPY --chmod=644 pyproject.toml uv.lock .python-version ./
COPY --chown=1000:1000 --chmod=755 orbis-user-api/ ./orbis-user-api/
COPY --chown=1000:1000 --chmod=755 orbis-cli/ ./orbis-cli/
COPY --chmod=644 orbis-user-web/pyproject.toml ./orbis-user-web/
COPY --chmod=644 orbis-gateway/pyproject.toml ./orbis-gateway/
COPY --chmod=644 orbis-data-receiver/pyproject.toml ./orbis-data-receiver/
COPY --chmod=644 orbis-indexer/pyproject.toml ./orbis-indexer/
COPY --chmod=644 orbis-omni-processor/pyproject.toml ./orbis-omni-processor/
COPY --chmod=644 orbis-retrievaler/pyproject.toml ./orbis-retrievaler/
COPY --chmod=644 orbis-statistic-offline/pyproject.toml ./orbis-statistic-offline/

FROM backend-source AS backend-test
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --all-packages --group dev
ENV PYTHONPATH=/app:/app/orbis-user-api/src:/app/orbis-cli/src
WORKDIR /app/orbis-user-api
CMD ["python", "-m", "pytest", "-q", "tests", "../orbis-cli/tests"]

FROM backend-source AS backend-dependencies
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --package orbis-user-api --no-dev

FROM python:3.12.15-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS backend
ENV PATH="/opt/venv/bin:${PATH}" PYTHONPATH=/app/orbis-user-api/src \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN groupadd --gid 1000 orbis && useradd --uid 1000 --gid 1000 --create-home orbis
WORKDIR /app
COPY --from=backend-dependencies /opt/venv /opt/venv
COPY --chmod=755 orbis-user-api/src/ ./orbis-user-api/src/
COPY --from=frontend-build --chmod=755 /app/orbis-user-web/dist/ ./orbis-user-web/dist/
USER orbis
EXPOSE 9201
CMD ["uvicorn", "orbis_user_api.main:app", "--host", "0.0.0.0", "--port", "9201", "--proxy-headers", "--forwarded-allow-ips", "*"]

FROM nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94 AS frontend
COPY --from=frontend-build --chmod=755 /app/orbis-user-web/dist/ /usr/share/nginx/html/
COPY --chmod=644 deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
