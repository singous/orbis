# Orbis CLI

独立的 Go 命令行应用，通过公开的工作空间 Agent API 访问 Orbis。它不导入后端内部包、不连接数据库，也不需要 Python。当前 CLI 版本为 `0.1.0`，使用 Agent 协议 `2.0` 和内容格式 `orbis.blocks.v1`。

## 构建与安装

使用 Go `1.27.2`，可以在本目录独立执行：

```sh
go mod download
go test ./...
go vet ./...
go build -o bin/orbis ./cmd/orbis
```

把 `bin/orbis` 放到 `PATH`。从完整源码目录也可运行 `make cli-build`。版本检查使用 `orbis --version`，参数帮助使用 `orbis --help` 或具体子命令的 `--help`。

## 配置与凭据

在 Orbis 账号设置中创建集成令牌，明确工作空间、权限、可选文集或单文档范围，以及有效期。令牌只展示一次。通过标准输入提供令牌，CLI 会先核验身份，再写入操作系统凭据存储：

```sh
orbis auth login --token-stdin \
  --base-url https://orbis.example/api \
  --workspace WORKSPACE_UUID
orbis --json doctor
```

Linux 使用 Secret Service，macOS 使用 Keychain，Windows 使用 Credential Manager。系统凭据存储不可用时，登录返回错误；不会降级为明文令牌文件。无桌面环境可由密钥管理器注入 `ORBIS_TOKEN`。不要将令牌放入命令参数、操作 JSON 或版本库。

非敏感配置支持具名实例：

```sh
orbis config set --profile work --base-url https://orbis.example --workspace WORKSPACE_UUID
orbis config get --profile work
orbis auth status --profile work
orbis auth logout --profile work
```

默认配置为 `~/.config/orbis/config.json`，`ORBIS_CONFIG_DIR` 可改变目录。全局参数可放在子命令前或后：`--json`、`--base-url`、`--workspace`、`--profile`、`--allow-http`、`--timeout`。配置优先级是显式参数、环境变量、选定配置；凭据优先使用环境变量，然后系统凭据存储。环境变量还包括 `ORBIS_BASE_URL`、`ORBIS_WORKSPACE_ID` 和 `ORBIS_PROFILE`。HTTP 必须为可信开发实例显式启用 `--allow-http`；请求超时默认 15 秒，最大 60 秒。客户端不使用环境代理，不跟随重定向，也不把授权信息发送至其他实例或工作空间。

## 发现与读取

```sh
orbis --json capabilities
orbis --json schema
orbis --json api ls
orbis --json workspaces list
orbis --json collections list --page 1 --page-size 20
orbis --json documents list --collection COLLECTION_UUID
orbis --json documents search '关键字'
orbis --json documents resolve --title '会议记录'
orbis --json documents resolve --id DOCUMENT_UUID
orbis --json documents resolve --url https://orbis.example/documents/DOCUMENT_UUID
orbis --json documents get DOCUMENT_UUID
orbis --json documents outline DOCUMENT_UUID --version 7 --page-size 32
orbis --json blocks list --document DOCUMENT_UUID --version 7 --page-size 32
orbis --json blocks get BLOCK_UUID --document DOCUMENT_UUID --version 7
orbis --json documents changes DOCUMENT_UUID --since-version 5 --version 7
```

管理列表使用 `--page`、`--page-size`，默认 20、最大 100。提纲、块和变更使用不透明 `--cursor`；后续页保留相同版本。块的 `payload_loaded=false` 表示正文尚未载入，须通过 `blocks get` 获取；子块单独分页，不把未载入内容当成空内容。

## 创建、导入与导出

```sh
orbis --json documents create --collection COLLECTION_UUID --title '草稿' --operation-id OPERATION_UUID
orbis --json documents import --collection COLLECTION_UUID --title '草稿' --file draft.md --operation-id OPERATION_UUID
orbis --json documents import --collection COLLECTION_UUID --title '草稿' --file - --operation-id OPERATION_UUID --dry-run
orbis --json documents export DOCUMENT_UUID --version 8 --format json --out document.json
orbis --json documents export DOCUMENT_UUID --version 8 --format markdown --out document.md
```

创建/导入可使用 `--parent UUID`；始终创建新文档。`--dry-run` 仅生成本地请求计划，不声称已通过服务端校验。导出必须指定版本与输出文件，JSON 保留结构，Markdown 的 `losses` 说明格式损失。导出成功后才替换输出文件。

超过 512 KiB 的 Markdown 自动使用分块协议，完整源文件最多 32 MiB。标准输入先写入私有临时文件，小输入仍可同步创建。分块上传校验完整源和每块 SHA-256；使用同一操作 UUID 与同一文件重试会从服务端确认偏移继续。客户端不重传已确认字节，不重启正在执行的任务。大导入需要服务端 Redis，小文档创建不需要。

```sh
orbis --json documents import --collection COLLECTION_UUID --title '长文' \
  --file large.md --operation-id OPERATION_UUID --wait-seconds 0
orbis --json imports get IMPORT_UUID
orbis --json imports finalize IMPORT_UUID --wait-seconds 60
```

等待默认 60 秒、最大 300 秒；`CLI_IMPORT_PENDING` 携带原导入 ID，退出码为 6。上传或受理不等于创建完成；只有完成回执才返回实际文档结果。

## 原子编辑与恢复

```sh
orbis --json operations preview --document DOCUMENT_UUID --file operation.json
orbis --json operations apply --document DOCUMENT_UUID --file operation.json
orbis --json operations get OPERATION_UUID
```

请求必须包含稳定 `operation_id`、`expected_version` 和 `operations`。通过 `schema` 读取精确联合类型。支持 `update_block`、`replace_text`、`insert_blocks`、`move_block`、`delete_block` 和 `update_metadata`；浅层更新不携带未读子树，删除容器须显式 `delete_subtree=true`。

```json
{"operation_id":"00000000-0000-4000-8000-000000000001","expected_version":7,"operations":[{"type":"replace_text","block_id":"00000000-0000-4000-8000-000000000002","expected_block_revision":7,"match":"草稿","replacement":"已审核草稿"}]}
```

JSON 请求文件最多 1 MiB，`--file -` 可读标准输入。创建与应用在响应丢失后先查询原始操作；仅在明确没有回执时重试完全相同的请求。未知或 pending 结果保留原操作 ID，不生成新键、不替换版本、不把后续拒绝当成首次写入未发生的证明。版本冲突应重新读取并生成新的业务意图。

## 附件与分享

```sh
orbis --json files upload --document DOCUMENT_UUID --file report.pdf --operation-id OPERATION_UUID
orbis --json files get FILE_UUID --document DOCUMENT_UUID
orbis --json files download FILE_UUID --document DOCUMENT_UUID --out report.pdf
orbis --json shares list --collection COLLECTION_UUID
orbis --json shares create --collection COLLECTION_UUID --root-document DOCUMENT_UUID --acknowledge-public-scope
orbis --json shares revoke SHARE_UUID --expected-version 1
```

附件要求独立的 assets 权限，最大 20 MiB。上传返回可供块操作使用的结构化资产引用；下载通过大小和 SHA-256 校验后才写出。

分享要求 `shares:manage` 和覆盖文集的范围。省略根文档会分享整个文集；当前与未来后代都公开，须显式确认。创建分享不自动重试，结果未知时先查询列表。分享与站点发布分离。

`request get|post` 是受同一授权约束的原始入口，只接受 `/api/v1/agent/workspaces/WORKSPACE_UUID/...` 路径，POST 使用 `--file`。支持能力以 `capabilities` 为准。

## 输出与退出码

`--json` 每次输出一个 `{code,message,request_id,data}`；服务端回执保留跟踪 ID，本地结果的 ID 为 null。凭据会从响应和错误中清除。

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功，含空列表 |
| 2 | 参数、输入、缺少配置或资源不存在 |
| 3 | 身份认证或凭据存储失败 |
| 4 | 无权限 |
| 5 | 版本或幂等冲突 |
| 6 | 网络、限流、结果未知或导入仍在处理 |
| 7 | 服务端或协议错误 |
| 8 | 不支持的能力 |
| 130 | 中断 |

兼容命令别名：`notes`/`documents`、`notebooks`/`collections`、`--note`/`--document`、`--notebook`/`--collection`、`--limit`/`--page-size`。

产品 Skill 位于独立目录 `skills/orbis`，可单独分发；`0.1.x` Skill 配合 `0.1.x` CLI 和 Agent 协议 `2.0` 使用。

## 原生画板

开发分支的原生画板使用同一套服务端命令和令牌范围校验：

```sh
orbis --json boards list --collection COLLECTION_UUID
orbis --json boards catalog
orbis --json boards templates
orbis --json boards template BOARD_UUID --template flow.approval --board-page PAGE_UUID --operation-id OPERATION_UUID
orbis --json boards create --file create-board.json
orbis --json boards get BOARD_UUID
orbis --json boards elements BOARD_UUID --board-page PAGE_UUID --revision 3
orbis --json boards apply BOARD_UUID --file board-commands.json
orbis --json boards changes BOARD_UUID --after 3
orbis --json boards history BOARD_UUID
orbis --json boards export BOARD_UUID --revision 3 --out diagram.orbis-board.json
```

创建请求包含固定的 `id`、`operation_id`、`collection_id`、`page_id`、
`parent_id`、`title` 与 `elements`；命令请求包含固定的 `operation_id`、
`schema_version: 1` 与 `commands`。图元与版本字段依实例 OpenAPI 和图形目录构造。
普通写入最多 500 个图元、1 MiB；失败后查询原始 `operations get OPERATION_UUID`，
保留原操作标识与意图重试。

读取要求 `documents:read`，写入要求 `documents:write`。单文档令牌不能创建新的目录画板。
图片导出还需要 `assets:read`；图片上传使用画板所属文档的 `files upload`。
导出固定版本后按页面游标读取，包含图片资产，文件最多 32 MiB、图片总量最多 16 MiB。
网页导入当前限制为单次 500 个页面与图元，超限整体拒绝，不截断内容。
