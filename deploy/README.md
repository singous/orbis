# Docker Compose 部署

部署依赖 Docker Engine 与 Docker Compose V2，当前验收版本为 Compose 2.40.3。
运行已构建的镜像不需要 Go、Node 或 CLI。以下命令从项目根目录执行。

## 配置文件的用途

| 文件 | 用途 |
| --- | --- |
| `deploy/.env.example` | Compose 部署主模板，复制到私有 `deploy/.env` 后填写 |
| 根 `.env.example` | 源码开发时显式导入 shell，服务不会自动读取 |
| `frontend/.env.example` | 前端源码构建选项，Compose 部署无需填写 |

Compose 的 `--env-file` 用于展开部署配置；只有 `compose.yaml` 声明的环境变量会传入容器。
前端通过同源 `/api` 访问服务，由 Nginx 代理，不需要在运行时设置 `VITE_API_BASE_URL`。
前端构建变量会进入浏览器代码，不能保存数据库、SMTP 或签名密钥。
Compose 进程中已导出的变量优先于 `--env-file`；部署应使用独立 shell，避免把源码开发的 `ORBIS_*` 配置带入部署。

## 首次安装

创建配置文件时保留已有文件：

```sh
(umask 077; set -C; cat deploy/.env.example > deploy/.env)
```

编辑 `deploy/.env`，至少填写以下项目：

- `ORBIS_DATABASE_PASSWORD`：内置数据库初始密码。默认连接串直接使用此值，应使用随机的 URL-safe 密码，建议64位十六进制。
- `ORBIS_SIGNING_KEY`：独立生成的至少32字节随机密钥。两份秘密不能共用。
- `ORBIS_API_IMAGE`、`ORBIS_WEB_IMAGE`、`ORBIS_COLLABORATION_IMAGE`：同一应用版本的不可变镜像引用，生产环境使用 `registry/name@sha256:...`。
- `ORBIS_COLLABORATION_KEY`：Go 与内部协同引擎共用的独立随机密钥，至少32字节，不与数据库或登录签名材料共用。
- `ORBIS_PUBLIC_BASE_URL`：用户实际访问的完整外部地址，用于公开链接、站点与确认邮件。

密码管理器可以生成随机十六进制值；如已安装 OpenSSL，也可分别使用 `openssl rand -hex 32` 生成。
初次安装后保留这些秘密。修改环境文件里的数据库密码不会修改已有卷中的 PostgreSQL 角色密码，凭据轮换需要单独执行。

内置数据库的连接串由一个密码来源自动派生，迁移与 API 使用同一值。
`ORBIS_DATABASE_URL` 仍可显式覆盖连接串；需要特殊字符密码时，应提供正确编码的 URL。
该覆盖不会自动移除内置 `db` 服务或改变依赖拓扑；外置数据库方案需要明确调整部署文件。

默认 Web 监听 `127.0.0.1:28190`。本机试用时设置 `ORBIS_PUBLIC_BASE_URL=http://127.0.0.1:28190`。
使用 HTTPS 公开域名时，由前置反向代理终止 TLS 并转发到 Web 端口，公开地址填写该 HTTPS 地址。
跨主机访问可按实际入口调整 `ORBIS_BIND_ADDRESS` 和 `ORBIS_PORT`。数据库、Redis、API 与协同引擎不发布宿主机端口。
浏览器的协同 WebSocket 经 Web/Nginx 连接 Go API；只在文档协同 socket 路径启用 Upgrade，登录 JWT 通过首帧传递。
前置反向代理也应允许该路径的 WebSocket；Go 每25秒发送 Ping，Nginx 为连接保留一小时空闲超时。
当前前端与 Nginx 模板按域名根路径部署，不提供子路径挂载配置。

为后续命令固定配置文件和 Compose project 名称：

```sh
compose() {
  docker compose --env-file deploy/.env -p orbis -f deploy/compose.yaml "$@"
}

compose --profile maintenance config --quiet
compose --profile maintenance pull db redis collaboration api web migrate
compose up -d --wait --wait-timeout 120 db redis
compose --profile maintenance run --rm --no-deps migrate
compose up -d --wait --wait-timeout 120 api web
compose ps
```

迁移是显式步骤，服务启动不会自动修改 schema。首次安装后打开 `/setup`，由使用者创建所有者账号；
部署命令不会代为注册账号。`web` 和 `api` 的健康检查分别确认 Nginx 与数据库连接就绪。

源码试用可先按根 README 构建 `server`、`frontend`、`collaboration` 三个镜像，将本地镜像引用填入私有配置，跳过远端拉取步骤。
镜像 ID 可用 `docker image inspect --format '{{.Id}}' IMAGE` 查询。迁移容器始终使用与 API 相同的镜像。

## 邮件与容量配置

`ORBIS_MAIL_TRANSPORT=disabled` 不投递确认邮件。`outbox` 只将邮件写入 `/data/mail-outbox` 私有目录；
真实投递使用 `smtp`，填写发件地址、SMTP地址、`starttls` 或 `tls` 及成对认证参数。启动不主动连接 SMTP。

`ORBIS_MAX_BODY_BYTES` 是 JSON 请求预算，默认8 MiB；`ORBIS_MAX_UPLOAD_BYTES` 是普通文件预算，默认32 MiB、最大1 GiB。
这些预算不会替代正文、表格或导入功能各自的业务限制。Nginx 上限保留最大文件及 multipart 余量。
存储路径与 Redis 地址属于容器内拓扑，由 Compose 固定，通常无需额外配置。

## 日常操作与维护

```sh
compose ps
compose logs --tail=100 api web collaboration db redis
compose exec -T api /orbis-server -healthcheck
compose exec -T api /orbis-server gc-assets
compose exec -T api /orbis-server gc-imports
compose restart collaboration api web
```

两个清理命令只处理有限批次的可回收资源，维护进程不启动额外队列 worker。
停止 API 会同时停止该进程中的导入 worker；Compose 为优雅退出保留45秒。
`stop` 或不带卷删除选项的 `down` 会保留数据，但下次启动仍须使用相同 project 名称和卷定义。

## 已有 Go 版本升级与备份

本节命令适用于默认内置 PostgreSQL 的已有 Go 部署。其他实现的数据转换是独立流程。
显式连接到外部数据库时，必须使用对应业务库的备份、迁移与恢复路径；内置 `db` 的备份不能替代外部业务库备份。
升级应安排维护窗口，先在验证环境核对目标版本的迁移说明与恢复方案。
保持原有 Compose project 名称、卷定义，以及 PostgreSQL、Redis 版本，应用升级不顺便升级数据库主版本。

从当前版本目录开始，先记录旧配置和正在使用的镜像：

```sh
umask 077
backup='/private/orbis-backups/upgrade-BACKUP_ID'
mkdir -p "$backup"
cp deploy/.env "$backup/deployment.env"
cp deploy/compose.yaml "$backup/compose.yaml"
compose images > "$backup/images.txt"
```

将 `backup` 改为私有、独立的备份位置，并保存目标版本与备份标识。
取得新版本部署文件、更新私有配置中的 API/Web/协同镜像及独立协同密钥后，先拉取并验证配置，成功后再停服：

```sh
compose --profile maintenance config --quiet
compose --profile maintenance pull api web collaboration migrate
compose stop web api collaboration
compose stop redis
compose ps -a
```

确认 API 与 worker 已退出，所有业务写入停止；Redis 停止使 AOF 落盘，数据库保持运行。
将数据库、私有文件、队列与配置作为同一批备份保存：

```sh
compose exec -T db pg_dump -U orbis -d orbis -Fc > "$backup/database.dump"
compose cp -a api:/data - > "$backup/private-data.tar"
compose cp -a redis:/data - > "$backup/redis.tar"
```

检查每条命令成功、备份可读，并在隔离环境验证恢复。文件档案应保留 UID/GID，API 的私有目录属于 UID65532。
备份包含对象、暂存导入、邮件能力链接、数据库和密钥，应作为私有数据保管。

备份完成后执行新镜像迁移；每条命令成功后才继续下一条：

```sh
compose --profile maintenance run --rm --no-deps migrate
compose up -d --wait --wait-timeout 120 redis
compose up -d --wait --wait-timeout 120 api web
compose ps
```

迁移失败时保持 API/Web 停服，保留日志和同批备份，不自动继续启动、不强制修改迁移状态。
服务严格检查 schema 版本，不能假定换回旧镜像即可恢复。
恢复应先在独立 project 与新卷中验证旧版本镜像、同批数据库、文件、Redis 和密钥，再审查入口切换。
恢复旧快照会丢失快照之后的新增数据，不能用升级前整库直接覆盖已经恢复写入的实例。
本流程不执行删除部署卷或自动向下迁移。

## 正文协同启用与同数据回退

新增 SQL 迁移只建立协同状态与更新记录，不批量转换用户文档。编辑器按文档启用，首次转换在文档事务中
逐项核对完整原生块、块 ID 和格式；校验失败时保留原文档。协同二进制状态、原生块查询投影、历史与回执均在 PostgreSQL，
Node 引擎没有持久化卷。备份仍包括同批数据库、私有文件、队列与原有密钥，不从临时内存房间恢复正文。

已有文档启用后，CLI、Agent、历史恢复与多维表格写入都要同步更新其 CRDT 状态。引擎不可用时相关写入返回
`COLLABORATION_UNAVAILABLE`，客户端保留待保存草稿；不能绕过同步直接写入块表。
上线前应在独立环境验证现有块组件、大文档、断线重连、撤权及 API/CLI，并单独审核存量服务切换。

回退使用支持该协同 schema 和协议的兼容镜像，保持当前数据库、文件、卷与协同状态，确认全部已提交内容仍可读写。
可以更换协同引擎的兼容构建；不能通过清除状态、重新从 JSON 播种或恢复升级前整库来回退。
不支持协同的旧二进制不能直接接管已启用文档。需要停用协同时应先停写、导出最新可恢复数据并准备明确的转换方案，
经审核验证后单独实施；部署命令不执行此类转换，也不会删除用户新增编辑。

## 部署验收

仓库提供独立的真实 Compose 验收，输入本地已构建的三个镜像：

```sh
sh scripts/testenv.sh compose --backend-image SERVER_IMAGE --frontend-image FRONTEND_IMAGE --collaboration-image COLLABORATION_IMAGE
```

该命令只使用合成配置、随机 project 与自己的容器、网络和卷，验证首次安装、显式迁移、健康检查、
维护命令、停止/启动迁移流程，以及整项目重建后 PostgreSQL、Redis 和私有文件的持久性，最后清理自己的资源。
它不读取部署配置、不连接现有数据库、不创建日常账号。当前版本的重复迁移验证幂等性，
未来版本的 schema 升级仍需要对应的 SQL 迁移测试和升级前验收。
