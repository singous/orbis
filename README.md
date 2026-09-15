# Orbis

Orbis 将个人知识记录、团队文档协作与对外文档站发布连接在一起。

Orbis connects personal knowledge, collaborative documents, and published
documentation sites in one workspace.

## Getting Started

## Base-MVP

- 块文档、文集与目录、自动保存、搜索、归档恢复、Markdown 导入导出。
- 工作空间成员与角色、文档评论和回复、讨论解决、正文历史与恢复。
- 多个文档站、独立目录与页面路径、预览、发布、版本切换和撤回。
- 匿名阅读与站内搜索、正文目录、深浅主题和移动端阅读。
- 青绿视觉体系；知识站、产品手册和帮助中心共用发布与阅读基础。

The base-MVP includes block documents, workspace collaboration, revision
history, and independently configured documentation sites. Editing a document
does not update its published site until the next explicit release.

实时共编、自定义域名、API 调试台和高级站点模板留待后续迭代。媒体使用
HTTP(S) 资源链接；发布会验证资源与链接边界，快照固定文档内容与 URL，
不复制外部服务器的媒体文件。

Real-time co-editing, custom domains, API playgrounds, and advanced templates
are future iterations. Releases preserve content and resource URLs; externally
hosted media is not copied into an asset snapshot.

## Repository Structure

```text
.
|-- orbis-gateway/             # Gateway behind nginx, in front of backend services
|-- orbis-user-api/            # Backend user API service
|-- orbis-user-web/            # Frontend user web application
|-- orbis-omni-processor/      # Multimodal data processing service
|-- orbis-indexer/             # Data write/indexing service
|-- orbis-statistic-offline/   # Offline task service
|-- orbis-retrievaler/         # External retrieval service
|-- orbis-data-receiver/       # External data reporting receiver service
|-- .editorconfig
|-- .gitignore
|-- .python-version
|-- pyproject.toml
`-- README.md
```

`orbis-user-api` and `orbis-user-web` contain the working base-MVP. The other
service directories reserve the existing boundaries for future knowledge
processing and retrieval capabilities.

## Development

Python is pinned to the 3.12 minor line:

```bash
uv python install 3.12
uv sync --package orbis-user-api --group dev
uv run python --version
```

The root `pyproject.toml` is configured for uv with `package = false`, so the
repository root acts as a tooling entrypoint rather than an installable Python
package.

Configure the API using [the environment template](orbis-user-api/.env.example).
Set a PostgreSQL connection and application secrets for the deployment.
Environment variables take precedence over dotenv files. For a fresh database:

```bash
cd orbis-user-api
../.venv/bin/alembic revision --autogenerate -m "initialize base mvp"
../.venv/bin/alembic upgrade head
../.venv/bin/uvicorn orbis_user_api.main:app --app-dir src --host 127.0.0.1 --port 9201
```

Alembic revisions are generated and managed per environment. For an existing
installation, generate the incremental revision against its current database
and review it before running `upgrade head`.

In another terminal:

```bash
cd orbis-user-web
npm ci
npm run dev
```

Open `http://127.0.0.1:9200/setup` to initialize the owner account. The frontend
proxies `/api` to port 9201; `ORBIS_DEV_API_TARGET` overrides the development
proxy target. Published sites use `/s/<site-slug>`.

本地启动后通过 `/setup` 初始化所有者账号。先创建文集与文档，再从“站点”
配置发布目录。编辑者可以准备站点配置；所有者或管理员负责发布、切换版本和撤回。
普通成员可以阅读和评论，正文编辑与历史恢复需要编辑权限。

## Verification

```bash
# From orbis-user-api
../.venv/bin/python -m pytest -q

# From orbis-user-web
npm run test:run
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser suite starts its own API and frontend on ports 9311 and 9310, using
a temporary database, file storage, and local mail outbox. It does not load
deployment dotenv files or send external mail. Tests and screenshots are
written under the ignored `test-results/` directory. To use an installed Chrome
instead, run `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`.

PostgreSQL integration tests are opt-in; see the instructions in
`orbis-user-api/tests/integration/test_postgres_base_mvp.py` for their isolated
database configuration. Generated migration files and local development
documents are excluded from Git.
