# Orbis Jenkins 构建与 Compose 发布

## 当前访问入口

- Orbis：`http://10.0.0.223:28190/`，首次使用进入 `/setup` 创建自己的所有者账号。
- API 文档：`http://10.0.0.223:28190/api/docs`。
- Jenkins：`http://10.0.0.223:28200/`，项目位于 `orbis` 文件夹。

以上为 NAS 局域网入口。运行镜像使用 Git 中的真实 React / FastAPI 应用。
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
初次接入时可使用包含 Jenkinsfile 的功能分支；合入 `develop` 后，将 Jenkins 配置中的
`ORBIS_SOURCE_REF` 切换到 `develop` 并重启控制器。

控制器没有构建执行器，也不挂载 Docker socket。专用 agent 使用一个执行器，
串行构建，避免在单机上同时运行多套重量级构建。出包阶段在临时测试容器中运行。
agent 有本机 Docker 管理权限，仅用于本项目受信任流水线；不接受外部 PR 自动部署。

## 出包与版本

构建产物是两个运行镜像，以及一个 JSON 发布清单。
发布标识采用 `release-<Jenkins build number>-<commit prefix>`，清单保存完整 Git SHA、
前后端镜像 digest、创建时间戳及数据库兼容合同。

NAS 本机镜像仓库监听 `127.0.0.1:28210`，数据持久化在 Jenkins 服务的 `data/registry`。
部署使用 digest，不跟随 `latest`，历史镜像与清单用于回滚。
当前采用本机仓库即可跑通出包，不依赖额外的外部仓库凭据；镜像仓库地址可由配置更换。

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
