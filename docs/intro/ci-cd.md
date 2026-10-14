# Orbis Jenkins 构建与 Compose 发布

## 当前访问入口

- Orbis：`https://orbis-dev.poflow.cn/`，首次使用进入 `/setup` 创建自己的所有者账号。
- API 文档：`https://orbis-dev.poflow.cn/api/docs`。
- 局域网入口：`http://10.0.0.223:28190/`。
- Jenkins：`http://10.0.0.223:28200/`，项目位于 `orbis` 文件夹。

公网入口由 nas-web 的 OpenResty 终止 TLS，再通过 NPS/NPC 转发到 NAS 的 28190 端口。
HTTP 自动跳转到 HTTPS，证书由 1Panel 自动续期。Jenkins 保留局域网入口。
运行镜像使用 Git 中的真实 React / FastAPI 应用。
后端、前端、PostgreSQL 由独立 Compose 项目 `orbis-app` 管理。
开发库位于本机，与既有共享开发数据库隔离；首次启动只创建表，保留应用的首次安装流程。

Jenkins 首次安装保留官方设置向导，日常管理员账号由使用者自己设置。
解锁信息位于 Jenkins 持久化目录的 `home/secrets/initialAdminPassword`，不要提交或外传。

## 流水线

| Jenkins 作业 | 行为 |
| --- | --- |
| `orbis/frontend` | 检出指定 Git 提交，运行 Vitest，检查 TypeScript 并构建 Vite，发布前端镜像 |
| `orbis/backend` | 检出指定 Git 提交，运行 API、CLI 与发布工具测试，构建并发布后端镜像 |
| `orbis/release` | 固定一次完整 commit SHA，依次调用两个构建作业，生成发布清单并部署 |
| `orbis/rollback` | 按历史发布标识恢复镜像与配置，重新检查页面和 API |

`release` 的 `GIT_REF` 选择需要出包的受信任分支或完整提交；`DEPLOY` 控制是否在出包后部署。
发布作业每五分钟检查受信任源分支，只在 Git 提交变化时自动运行；人工也可随时触发。
初次接入时可使用包含 Jenkinsfile 的功能分支；合入 `develop` 后，将 Jenkins 配置中的
`ORBIS_SOURCE_REF` 切换到 `develop` 并重启控制器。

控制器没有构建执行器，也不挂载 Docker socket。专用 agent 使用一个执行器，
串行构建，避免在单机上同时运行多套重量级构建。出包阶段在临时测试容器中运行。
临时测试库与 scratch 文件使用容器的内存文件系统，测试报告保存在持久化目录，
避免大量 SQLite 测试事务在 NAS 磁盘上执行同步写入。
agent 有本机 Docker 管理权限，仅用于本项目受信任流水线；不接受外部 PR 自动部署。

## 出包与版本

构建产物是两个运行镜像，以及一个 JSON 发布清单。
发布标识采用 `release-<Jenkins build number>-<commit prefix>`，清单保存完整 Git SHA、
前后端镜像 digest、创建时间戳及数据库兼容合同。
`created_at`、`deployed_at` 和 `failed_at` 使用 Unix 时间戳，单位为秒；界面与操作记录按 UTC+8 展示。

当前镜像仓库为 Harbor 的私有 `orbis` 项目，镜像地址为
`hub.poflow.cn/orbis/frontend` 与 `hub.poflow.cn/orbis/backend`。
部署使用 digest，不跟随 `latest`，历史镜像与清单用于回滚。

Jenkins 文件夹凭据 `orbis-harbor-push` 对应项目推拉机器人，`orbis-harbor-pull` 对应只读机器人。
流水线按阶段绑定凭据，通过 stdin 登录并使用临时 Docker 配置；阶段结束即移除临时配置。
人工部署使用运行目录 `registry/docker/config.json` 中的只读凭据，不覆盖用户全局 Docker 配置。
密钥不进入 Git、发布清单或构建日志。轮换机器人密钥时同时更新对应 Jenkins 凭据和部署侧配置。

镜像层通过本机 `127.0.0.1:28182` 代理到 Harbor 的 loopback `28181`，不经公网穿透。
代理只监听 loopback，提供本机 Docker HTTP 认证端点和上传地址；公网 Harbor 的 HTTPS 配置保持独立。
发布时再读取公网仓库的 manifest，记录可在外部使用的镜像 digest；部署先通过本机路径预取镜像层，
再由 Compose 校验公网 manifest 并启动服务。因此仍需要公网域名可达，但大文件传输留在本机。

Jenkins 部署配置示例：

```dotenv
ORBIS_REGISTRY=hub.poflow.cn
ORBIS_REGISTRY_TRANSPORT=127.0.0.1:28182
ORBIS_PUSH_CREDENTIAL_ID=orbis-harbor-push
ORBIS_PULL_CREDENTIAL_ID=orbis-harbor-pull
COMPOSE_PROFILES=harbor
```

旧 Registry `127.0.0.1:28210` 与其数据继续保留。历史镜像已按原摘要迁移到 Harbor，
运行目录 `registry-migration.json` 保存验证过的地址映射。发布和回滚使用此映射，
不修改原始历史清单，也不允许映射到不同内容的摘要。

Jenkins 保留各阶段日志、JUnit 报告、组件镜像元数据和完整发布清单。
不要删除仍被发布清单引用的镜像；只清理确认不再需要的临时测试镜像和构建缓存。

## Compose 运行与持久化

本机运行目录：`/vol1/1000/Deploy/internal/orbis-dev`。

```text
.env                  # 数据库及应用密钥，仅本机保存
images.env            # 当前成功版本的镜像摘要
docker-compose.yml    # 当前成功版本的部署配置
state.json            # 当前和上一成功发布标识
releases/<id>/        # 每个版本的 manifest 与 Compose 配置
registry/docker/     # 部署机器人 Docker 配置，仅本机保存
registry-migration.json # 历史镜像的摘要不变地址映射
data/postgres/        # 开发数据库
data/api/             # 上传文件、邮件 outbox
```

项目根目录可以执行：

```bash
make app-status
make app-up
make app-logs
make rollback RELEASE=release-1-<commit-prefix>
```

也可在运行目录直接操作：

```bash
docker compose --env-file .env --env-file images.env -p orbis-app up -d --wait
docker compose --env-file .env --env-file images.env -p orbis-app ps
```

停止或重建应用容器不会删除数据库、文件或密钥。禁止执行 `down -v`，禁止以旧数据库覆盖新增数据。
DPanel 可读取这里的 Compose 项目并查看容器和日志；正式发布与回滚统一从 Jenkins 或发布脚本发起。

运行目录 `.env` 中的 `ORBIS_PUBLIC_URL=https://orbis-dev.poflow.cn` 用于邀请、所有权转移及公开站点链接。
此配置独立于镜像版本，发布和回滚均保留。云端代理覆盖客户端提供的转发协议头，
应用内层 nginx 保留有效的 HTTP/HTTPS 协议值；直连局域网时使用本次请求的协议。
公网路由、证书及对应资源的撤销记录保存在运行目录 `public-access.json` 和 README 中。

直接执行 Compose 拉取时，先设置 `DOCKER_CONFIG="$PWD/registry/docker"`。
仓库根目录的 `make app-up`、`make rollback` 自动读取运行目录的只读认证配置，并验证页面和 API。

## 部署验证与回滚

发布流程先校验清单和不可变镜像，拉取镜像并等待数据库、API、前端健康。
随后请求前端 `/setup`、入口 JavaScript、`/api/healthz` 和 OpenAPI，并核验数据库表存在。
所有验证成功后才更新当前发布记录和直接操作的 Compose 入口。

部署失败时保留失败记录，恢复上一成功版本并再次验证，原发布记录不会前进。
并发发布由文件锁阻止。手动回滚使用保留的镜像和 Compose，不重新编译历史源码。

当前数据库合同为 `orbis-base-mvp-v1`，只适用于兼容的应用发布。
涉及破坏性模型、数据或接口变化时必须按人工审核与单次授权规则处理，并规划一致性备份和恢复。
镜像回滚不等于数据恢复；本开发部署不自动执行破坏性 Alembic 迁移。

## 工具容器

Python 工具环境由仓库根目录 `compose.yaml` 提供：

```bash
make setup
make shell
make check
```

源码目录挂载到 `/workspace`，容器虚拟环境存放在 `.dev/venv`，开发缓存均排除 Git。
这些命令用于修改和检查代码；实际运行的应用由上面的发布 Compose 管理。
