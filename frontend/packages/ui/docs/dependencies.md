# 依赖与复制源码维护

新增、升级或移除 UI 依赖时，同步维护锁文件、来源、许可和实际发行内容。复核级许可证及双许可选择须记录真实分发范围、选择与评估依据；工程评估和实际人类批准分别记录，不能伪造批准者或把材料限制写成法律保证。`check:licenses` 离线校验前端实际交付范围；完整工具库存事项继续报告，下载对应源码发生在打包阶段。

## 为新增或升级准备准入证据

在 PR 中逐项说明以下十项，链接到实际版本的材料；未确认的项目保留为待决。

| 项目 | 需要记录的事实 |
| --- | --- |
| 标识 | 组件名、精确版本、SPDX 标识、许可证原文文件或链接。 |
| 分发形态 | 直接或传递依赖；runtime、build-only、dev-only、copied code 或资产；是否进入浏览器、最终镜像、静态资源或公开站点。 |
| 版权 | 原始版权持有者和年份；Apache-2.0 组件是否带独立 NOTICE。 |
| 修改 | 修改过的上游文件及用途，保留声明和提供修改源码的处理。 |
| 声明义务 | 对应的完整许可文本、版权、NOTICE，以及字体保留名称等独立要求。 |
| 对应源码 | 适用时固定实际源码 revision、URL、checksum 和构建材料，说明它们与发行包的对应关系。 |
| 资产 | 字体、图标、图片、模板、模型和示例数据各自的来源与许可。 |
| 获取方式 | npm 包、内嵌依赖或复制的 registry/snippet；不能把包名相同当作实物相同。 |
| 组合复核 | 与项目许可及实际分发方式有关的工程评估或实际人类批准；双许可选定的分支及证据限制。 |
| 已更新材料 | 根 notice、npm manifest、许可文本、源码记录和 copied-code/资产登记。 |

允许级按现有许可策略登记；复核级保留真实评估与选择记录；实际交付的 unknown、无许可和禁止级不能靠补一个 SPDX 字符串放行。未随前端交付的构建/测试工具保留独立事项，不以产品发行就绪冒充完整库存已经闭环。依赖自己的许可不能覆盖其内嵌包、字体或图标。npm `inBundle` 内容以实际发行 tarball 为准，不能仅凭 override 或锁文件表面版本宣称已替换。

## 升级复制的 shadcn 源码

候选文件先下载到独立临时目录，与保留的源快照比较。以下示例在 `frontend/` 执行，只下载候选，不覆盖组件：

```sh
orbis_ui_candidate_dir=$(mktemp -d)
curl --fail --location --silent --show-error \
  https://ui.shadcn.com/r/styles/base-nova/button.json \
  --output "$orbis_ui_candidate_dir/button.registry.json"
shasum -a 256 "$orbis_ui_candidate_dir/button.registry.json"
git diff --no-index ../licenses/copied-code/shadcn-button.registry.json \
  "$orbis_ui_candidate_dir/button.registry.json"
```

`git diff --no-index` 返回 1 表示存在差异。registry URL 的当前响应不是既有来源版本的证明；把候选内容与可核验的上游 revision 对齐，并保留其精确 checksum。人工合并到本地组件，保留 Orbis Props、token、焦点、Portal、disabled/loading 和领域直接子节点契约，禁止 CLI `--overwrite`。

来源登记位于 [ui.registry.json](../ui.registry.json)，原始 JSON 快照位于根 `licenses/copied-code/`。更新来源版本/revision、checksum、style、获取工具版本、更新时间和 modifications，保留初次引入时间。时间字段须说明单位和所记录的事件，不用文件 mtime 推测下载时间。无法确认的来源信息如实保留待决，不能编造 commit 或历史时间。版权或许可变化重新走准入，更新完整文本和 notice。

`sourceRevisionKind: "reproducible-content"` 表示该 Git 提交的源码经实际上游生成函数产出的内容与保留快照逐字节一致；它不证明历史服务部署，`servedRevision: null` 仍表示未知。`addedAt` / `updatedAt` 按 registry 中声明的 Unix 毫秒及 Git 事件语义维护，不能将 metadata-only 更新当作直接实现修改。

普通 npm 升级使用现有 npm 锁文件流程，重新生成并审阅 inventory diff。保留普通发行包和对应源码的区别；匹配版本号或成功发布不等于已证明源码对应关系。

## 验证变更与发行材料

从 `frontend/` 执行现有检查，按实际组件和消费者补齐业务验证。打包发行材料时，使用已公开完整源码与构建材料的提交之干净检出；下例将该完整 SHA 传给 `ORBIS_SOURCE_REVISION`，具体约定见[许可材料说明](../../../../licenses/README.md)：

```sh
npm run licenses:generate -- --check
npm run check:licenses
npm run typecheck
npm run test:types
npm run test:run
npm run test:storybook
npm run test:ui
npm run storybook:build
npm run build
npm run check:bundle -- --complete
ORBIS_SOURCE_REVISION="$(git rev-parse HEAD)" npm run licenses:bundle -- dist/licenses
npm run check:license-bundle
```

修改依赖图后先通过现有生成命令更新材料，再运行上述 `--check`。保留原 bundle 基线与 feature-own 归属。涉及外观的变更使用固定 Linux 视觉比较；涉及跨模块协议、编辑器、画布或网格的变更同时验证真实消费者。发布构建及最终镜像校验还必须确认许可目录、声明、源码记录和公开链接可用；普通 `build` 通过不代表发行材料已通过。

组件公共 API 仍按 [authoring](authoring.md) 和维护者评审处理。新增参数优先保持兼容，再迁移消费者；源码更新本身不自动把 experimental 组件晋级为 stable。

## 移除依赖或复制组件

先检查直接和传递消费者，再移除代码、锁文件条目及相应登记。仍被其他依赖或资产使用的许可文本继续保留；已经不再使用的 notice 和专用源码记录同步清理。重新生成 manifest 并审阅变化，不保留与实物不符的过期声明。
