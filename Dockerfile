FROM golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS server-source
WORKDIR /src
ENV GOTOOLCHAIN=local GOMAXPROCS=2 GOMEMLIMIT=768MiB
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY migrations ./migrations
COPY api ./api
COPY tests ./tests
COPY tools ./tools
COPY cli ./cli
COPY .go-version ./

FROM server-source AS server-test
CMD ["go", "test", "./..."]

FROM server-source AS server-build
ARG ORBIS_VERSION=0.1.0-dev
RUN CGO_ENABLED=0 go build -trimpath -buildvcs=false \
    -ldflags="-s -w -X main.version=${ORBIS_VERSION}" \
    -o /out/orbis-server ./cmd/server
RUN mkdir -p /out/data && chmod 0700 /out/data

FROM scratch AS server
COPY --from=server-build /out/orbis-server /orbis-server
COPY --from=server-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=server-build /usr/share/zoneinfo/Asia/Shanghai /usr/share/zoneinfo/Asia/Shanghai
COPY --from=server-build --chown=65532:65532 /out/data /data
USER 65532:65532
ENV TZ=Asia/Shanghai ORBIS_LISTEN_ADDRESS=0.0.0.0:9202 ORBIS_STORAGE_DIR=/data
EXPOSE 9202
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/orbis-server", "-healthcheck"]
ENTRYPOINT ["/orbis-server"]
CMD ["serve"]

FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS collaboration-source
WORKDIR /app/collaboration
COPY --chmod=644 collaboration/package.json collaboration/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY --chown=1000:1000 --chmod=755 collaboration/ ./
COPY --chmod=755 frontend/src/ /app/frontend/src/
RUN mkdir -p /app/api && chmod 755 /app/api && chown 1000:1000 /app/collaboration
COPY --chmod=644 api/editor-prosemirror-schema.json /app/api/editor-prosemirror-schema.json

FROM collaboration-source AS collaboration-test
CMD ["npm", "test"]

FROM collaboration-source AS collaboration-build
RUN npm run build

FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS collaboration
WORKDIR /app
COPY --from=collaboration-build --chown=1000:1000 --chmod=644 /app/collaboration/dist/ ./
USER 1000:1000
ENV NODE_ENV=production ORBIS_COLLABORATION_HOST=0.0.0.0 ORBIS_COLLABORATION_PORT=9203
EXPOSE 9203
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.ORBIS_COLLABORATION_PORT||9203)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.mjs"]

FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS frontend-source
WORKDIR /app/frontend
COPY --chmod=644 frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY --chown=1000:1000 --chmod=755 frontend/ ./
RUN mkdir -p /app/api && chmod 755 /app/api
COPY --chmod=644 api/editor-components.json /app/api/editor-components.json
COPY --chmod=644 api/board-catalog.json api/board-icons.json api/board-templates.json /app/api/
COPY --chmod=644 api/editor-prosemirror-schema.json /app/api/editor-prosemirror-schema.json
RUN mkdir -p node_modules/.vite && chown 1000:1000 . node_modules/.vite

FROM frontend-source AS frontend-test
CMD ["npm", "run", "test:run"]

FROM frontend-source AS frontend-build
RUN npm run build

FROM nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94 AS frontend
COPY --from=frontend-build --chmod=755 /app/frontend/dist/ /usr/share/nginx/html/
COPY --chmod=644 deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
