# 开发与运行参考

[返回项目首页](../../README.md) · [部署指南](../../deploy/README.md)

以下命令均从项目根目录执行。

## 架构与契约

| 部分 | 实现 |
| --- | --- |
| 后端 | 根 Go module，Go 版本固定在 `.go-version` |
| HTTP 与数据访问 | Gin、GORM、PostgreSQL |
| 数据库迁移 | golang-migrate、版本化 SQL |
| 装配、日志与配置 | 构造函数注入、`log/slog`、集中校验的 `ORBIS_*` 环境变量 |
| 文件 | 私有本地存储，业务通过存储接口访问 |
| 持久化任务 | PostgreSQL outbox、Asynq、Redis |
| 前端 | React、TypeScript、Vite，独立 npm 项目 |
| 正文协同 | Tiptap 2、Yjs；Go 管理 WebSocket、权限与原子持久化，独立 Node.js 24 进程执行无状态转换 |
| CLI | 独立 Go module，通过公共 API 访问服务 |
| Skill | `skills/` 中可独立分发的操作规范与示例 |
| 交付 | 无 CGO 的 Go 服务镜像、Nginx 前端镜像、协同引擎镜像、Compose |

具体依赖版本以各模块 `go.mod`、`go.sum`、`frontend/package-lock.json` 和 `collaboration/package-lock.json` 为准。
后端 module 为 `orbis.local/orbis`，CLI 为 `orbis.local/orbis/cli`。
CLI 不导入后端内部包或直接连接数据库。Skill 调用 CLI，前端和未来 MCP 直接调用后端 API。

[OpenAPI 契约](../../api/openapi.json) 是客户端适配的依据，服务运行时也提供 `/openapi.json`。
私有应用 API 位于 `/api/v1/`；工作空间资源显式包含工作空间 ID，CLI 使用单独的 Agent 入口。
JSON 响应包含 `code`、`message`、`request_id`、`data`，失败使用实际 HTTP 状态。
时间点统一为 Unix 毫秒整数，可选时间返回 `null`，默认展示时区为 `Asia/Shanghai`。
管理列表使用 `page/page_size/total`，默认每页20、最多100；块读取使用固定版本的不透明游标。
二进制下载、公开 HTML 和文件导出按各自协议返回。

```text
cmd/server/               服务、数据库迁移与维护命令
internal/app/             装配、生命周期与跨模块事务
internal/transport/http/  HTTP 路由、DTO 与中间件
internal/                 身份、工作空间、文档、表格、发布、分享等业务模块
api/                      OpenAPI 与共享内容契约
migrations/               版本化 SQL，随产品源码交付
tests/                    按业务组织的 Go 集成与契约测试
frontend/                 Web 应用、贴近业务的单元测试及浏览器验收
collaboration/            无状态 Yjs 转换进程、持久化与并发回归测试
cli/                      独立 Go CLI module
skills/                   独立分发的产品 Skill
tools/testenv/            Go 编写的隔离测试启动器
scripts/                  构建、格式与工具链脚本
deploy/                   通用 Compose、Nginx 与配置示例
```

## 本地开发

需要 `.go-version` 固定的 Go、Node.js 24，以及用于隔离依赖的 Docker。
`scripts/go.sh` 会核对 Go 版本；可通过 `ORBIS_GO_BIN` 显式指定工具链二进制路径。
产品开发、测试与 CI 无需 Python。

按 [.env.example](../../.env.example) 准备专用开发库和私有配置。服务不会读取 dotenv 文件，
配置由开发 shell 或容器运行环境显式注入。签名密钥至少32个随机字节。

```bash
export ORBIS_DATABASE_URL='postgres://orbis:YOUR_PASSWORD@127.0.0.1:5432/orbis_dev?sslmode=disable&connect_timeout=5'
export ORBIS_SIGNING_KEY='YOUR_RANDOM_SIGNING_KEY_AT_LEAST_32_BYTES'
export ORBIS_STORAGE_DIR='.dev/storage'
export ORBIS_PUBLIC_BASE_URL='http://127.0.0.1:9200'

make backend-migrate
make backend-run
```

迁移命令只操作显式指定的数据库。服务默认监听 `127.0.0.1:9202`，启动不会自动迁移或创建用户。
在另一个终端启动前端：

```bash
make frontend-install
npm --prefix frontend run dev
```

打开 `http://127.0.0.1:9200/setup` 初始化所有者账号。前端保留 `/api` 前缀代理到后端，
`ORBIS_DEV_API_TARGET` 可覆盖代理目标。公开文档站使用 `/s/<slug>`，实时分享使用 `/share/<token>`。

构建独立 CLI：

```bash
make cli-build
bin/orbis --help
```

独立开发 CLI 时，在 `cli/` 下使用 `go test ./...` 与 `go build ./cmd/orbis`。
连接、令牌和命令示例见 [CLI README](../../cli/README.md)，产品 Skill 位于 [skills/orbis](../../skills/orbis/SKILL.md)。
在集成设置中生成工作空间专用令牌，不将浏览器登录 JWT 用作 Agent 令牌。

## 文件、邮件与任务配置

| 环境变量 | 用途 |
| --- | --- |
| `ORBIS_DATABASE_URL` | 显式 PostgreSQL 连接 |
| `ORBIS_SIGNING_KEY` | 登录与能力令牌签名材料 |
| `ORBIS_LISTEN_ADDRESS` | 默认 `127.0.0.1:9202` |
| `ORBIS_STORAGE_DIR` | 私有、可持久化的本地对象目录 |
| `ORBIS_MAX_BODY_BYTES` | JSON 请求预算，默认8 MiB |
| `ORBIS_MAX_UPLOAD_BYTES` | 普通文件上限，默认32 MiB、配置上限1 GiB |
| `ORBIS_PUBLIC_BASE_URL` | 邮件确认和公开链接使用的实例地址 |
| `ORBIS_REDIS_URL` | 持久化分块导入队列，相关任务需要显式配置 |
| `ORBIS_COLLABORATION_URL` | 内部协同引擎 HTTP origin；与独立服务密钥同时配置 |
| `ORBIS_COLLABORATION_KEY` | Go 与协同引擎共用的独立随机密钥，至少32字节，不传到浏览器 |
| `ORBIS_MAIL_TRANSPORT` | `disabled`、私有 `outbox` 或 `smtp` |
| `ORBIS_MAIL_OUTBOX_DIR` | 仅 `outbox` 使用的私有收件目录 |
| `ORBIS_MAIL_FROM` | 发件地址 |
| `ORBIS_SMTP_ADDRESS` | SMTP 主机与端口 |
| `ORBIS_SMTP_SECURITY` | `starttls` 或 `tls`，验证服务端证书 |
| `ORBIS_SMTP_USERNAME` / `ORBIS_SMTP_PASSWORD` | 可选 SMTP 认证 |

头像输入最多2 MiB，转换为静态256×256 PNG。Markdown 同步导入最多2 MiB；
Agent 分块导入最多32 MiB，每块256 KiB，结果可通过任务 ID 查询。
常规文档、上传及格式转换均有独立内容和并发预算，详见 OpenAPI。

`gc-assets`、`gc-imports` 是显式、有限批次的维护命令：

```bash
bin/orbis-server gc-assets
bin/orbis-server gc-imports
```

维护命令不删除当前文档、历史或发布内容仍需使用的 ready 文件。

## 正文协同与恢复

首次打开时，前端请求 Go 从原生块文档初始化一次持久化 Yjs 状态，此后始终恢复同一份二进制身份。
普通并发文字与格式修改自动合并；Go 在同一事务保存 CRDT 状态、块查询投影、历史与操作回执，
提交完成后才发送保存确认。CLI、Agent、历史恢复与多维表格写入通过同一状态适配，发布继续读取完整原生快照。
WebSocket 的 access JWT 仅在首帧传递，不放入 URL；会话、资源可见性与写权限持续复验。

源码开发时可先构建并启动独立引擎，按 [collaboration/README.md](../../collaboration/README.md) 设置 Go 与引擎的共同密钥。
完整 Compose 已声明该服务。未配置引擎的原生开发环境保留已有编辑协议；启用协同的文档需要引擎才能继续写入。
旧块内容保留在原生查询投影中，启用时校验块 ID 与正文语义完全一致，失败不会部分迁移。

网络中断保留二进制草稿、原操作 ID 与修改目标，重连安全重试。块移动和删除可能使另一个离线编辑的原节点失效，
此时返回 `COLLABORATION_TARGET_REMOVED`，保留草稿并进入显式恢复流程，避免静默丢失修改。
原生画板独立保存，正文只保存画板引用。旧绘图块不再提供编辑、预览或导出入口，打开可编辑正文时通过普通正文事务移除，不重建其他内容的 CRDT 身份。
组件属性也作为整体提交；属性修改与另一端的同块修改发生竞争时保留草稿供恢复，避免属性对象互相覆盖。
停用引擎不会清除协同状态，也不会将活跃文档重新从 JSON 初始化；部署切换与同数据回退见部署指南。

## 构建与新安装

```bash
make backend-build cli-build frontend-build collaboration-build

docker build --target server --build-arg ORBIS_VERSION=0.1.0-dev -t orbis-server:local .
docker build --target frontend -t orbis-frontend:local .
docker build --target collaboration -t orbis-collaboration:local .
```

根 Dockerfile 是唯一镜像构建定义。服务镜像只包含服务二进制、CA 证书、业务时区和私有数据目录；
CLI 独立构建为 `bin/orbis`，前端产物由 Nginx 交付；协同镜像只运行固定版本 Node 与两个打包后的模块。

当前推荐使用完整 Docker Compose 部署，运行镜像只需要 Docker Engine 与 Compose V2。
[部署模板](../../deploy/compose.yaml) 包含 PostgreSQL、Redis、API、协同引擎和 Nginx，主配置模板为
[deploy/.env.example](../../deploy/.env.example)。内置数据库只需填写一个密码来源，连接串由 Compose 派生；
显式 `ORBIS_DATABASE_URL` 覆盖仍可使用。根 `.env.example` 与 `frontend/.env.example` 分别用于源码开发和前端构建。

首次安装、镜像准备、升级、同批备份恢复边界和维护命令见 [Compose 部署指南](../../deploy/README.md)。
准备私有部署配置及对应版本的不可变镜像引用后，固定原有 project 名称并执行：

```bash
docker compose --env-file deploy/.env -p orbis -f deploy/compose.yaml up -d --wait db redis
docker compose --env-file deploy/.env -p orbis -f deploy/compose.yaml --profile maintenance run --rm --no-deps migrate
docker compose --env-file deploy/.env -p orbis -f deploy/compose.yaml up -d --wait api web
```

数据库、Redis、API 和协同引擎不发布宿主机端口。Web 默认绑定回环地址，私有文件与队列使用持久化卷。
按实际环境设置入口地址、持久化路径、备份及资源限制；模板不会自动接管已有部署或初始化用户。

## 数据迁移边界

旧实现源码、旧协议测试及离线转换工具在产品目录之外保存。转换工具是绑定目标 schema 版本、
可独立构建和测试的 Go 项目，不是服务镜像或日常开发的依赖。

本项目的 SQL migrations 只用于新后端数据库，不直接应用到其他数据库结构。
实际数据转换、凭据及分享链接的过渡、服务切换和回退方案需要单独验证。
兼容配置仅在经过审核的数据转换中启用，现有运行服务和数据不会随源码目录整理而改变。

## 验证

```bash
make backend-check cli-check
make frontend-check frontend-build
make collaboration-install collaboration-check collaboration-build
docker build --target collaboration -t orbis-collaboration:test .
export ORBIS_TEST_COLLABORATION_IMAGE=orbis-collaboration:test
make integration TEST_ARGS='-race -v'

# Install the browser runtime once in the test environment.
cd frontend
npx playwright install --with-deps chromium
npm run test:e2e
```

`make check`、`make test` 和 `make build` 分别汇总后端、CLI、前端与协同引擎的检查、单元测试和构建。
Go 单元测试按惯例贴近源码，Go 集成测试位于 `tests/<业务模块>/`；前端单元与组件测试贴近业务代码，
浏览器验收位于 `frontend/tests/e2e/`。Skill 独立分发，声明兼容的 CLI 和 API 版本。

`tools/testenv` 通过 Docker CLI 创建独占的 PostgreSQL、Redis、文件目录和 outbox；
设置 `ORBIS_TEST_COLLABORATION_IMAGE` 时还创建并清理独占的协同引擎，集成与浏览器验收使用同一输入。
协同专用 Go 测试使用 `NewWithCollaboration`；未提供引擎镜像时明确跳过，完整验收与 CI 必须提供。
每个集成测试使用新数据库，只清理自身资源。入口脚本先编译 Go 工具并直接执行，以便信号退出时完成清理。
可通过 `ORBIS_TEST_IMAGE` 选择含固定 Go 工具链和 C 编译器的测试镜像，
或使用 `sh scripts/testenv.sh integration --package ./tests/document -race -v` 选择模块。
浏览器测试默认使用9311/9310端口，拒绝复用已有服务，不读取部署配置。

```bash
make smoke IMAGE=SERVER_IMAGE FRONTEND_IMAGE=FRONTEND_IMAGE
sh scripts/testenv.sh compose --backend-image SERVER_IMAGE --frontend-image FRONTEND_IMAGE --collaboration-image COLLABORATION_IMAGE
```

镜像检查覆盖迁移、健康检查、文件维护、启动不创建用户、优雅退出、前端静态资源/API代理，
以及凭据与能力链接的日志脱敏。独立 Compose 验收还覆盖真实部署文件、卷权限、重建持久性和维护流程。
CI 分别验证后端、独立 CLI、前端、协同引擎、启用协同的隔离浏览器流程与 Compose 部署。
