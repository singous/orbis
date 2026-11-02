# Orbis Frontend

React、TypeScript 与 Vite 前端，通过后端公开 API 提供工作空间、文档编辑和公开阅读界面。

## 开发与构建

使用 Node.js 24 和 npm。依赖版本由 `package-lock.json` 固定。

```sh
npm ci
npm run dev
npm run typecheck
npm run test:run
npm run build
```

开发服务器默认监听 `127.0.0.1:9200`，将 API 与公开站点请求代理到 `127.0.0.1:9202`。
可通过 `ORBIS_DEV_API_TARGET` 指定后端地址。生产静态文件输出至 `dist/`，由项目的 Nginx 配置交付。

## 目录

- `src/app/`：应用入口、路由与全局 provider。
- `src/features/`：按产品业务组织；文档编辑器在 `documents/editor/`，通用内容模型和编解码在 `content/model/` 与 `content/codecs/`，统一入口为 `content/blocks.ts`。
- `src/shared/`：HTTP 客户端、认证、平台适配、导航与 UI 基础组件。
- `src/styles/`：共享样式。
- `tests/e2e/`：浏览器业务旅程与测试辅助代码；单元、组件测试与对应业务源码放在一起。
- `tools/benchmarks/`：编辑器性能测量工具。

内容组件登记由后端 `api/editor-components.json` 维护；`npm run sync:document-blocks` 更新前端副本，构建时检查同步状态。

## 工作区布局

`app/router.tsx` 只装配顶层路由。`workspace-routes.tsx` 的私有页面全部挂在同一个认证父路由下；公开阅读、公开表单和邀请由 `public-routes.tsx` 单独组织。既有 URL 与权限边界保持兼容。

`WorkspaceRoute` 通过 `Outlet` 渲染页面，并持有搜索作用域和稳定的 `WorkspaceFrame`。`WorkspaceLayout` 负责公共外壳，`WorkspaceShell` 只向所属布局提供页头、侧栏和上下文面板配置，正文直接留在正常 React 树中，不通过 portal 迁移。页面内部的加载占位使用 `loading` 保留当前区域导航、撤销旧页面操作；跨路径切换显式重置正文局部状态、滚动和移动抽屉。

| 状态或资源 | 所有者 | 生命周期 |
| --- | --- | --- |
| 查询缓存、错误反馈 | `AppProviders` | 当前认证会话；切换会话清理旧缓存 |
| 搜索框、公共导航、布局 | `WorkspaceRoute` / `WorkspaceFrame` | 私有工作区父路由 |
| 抽屉焦点、关闭、滚动清理 | `use-workspace-drawers` | 公共布局，显式响应路径变化 |
| 文档类型选择 | `app/DocumentRoute` | 只加载所需的正文、画板或数据表运行时 |
| 画板会话、图片缓存、离页保护 | `use-board-session` | 画板及凭据/工作空间；刷新 token 保留会话 |
| 编辑器选区、工具、菜单和草稿 | 各业务页面与控制器 | 当前页面或嵌入实例；不放入公共外壳 |
| 内容契约与格式转换 | `content/model` / `content/codecs` | 纯模型与格式适配分开；持久化格式不变 |

未开放的工作区入口统一由 `src/shared/release-features.ts` 控制；隐藏入口不删除历史数据，已有公开交付协议继续兼容。

笔记本的常用设置是按工作空间保存在当前浏览器中的偏好，并同步到其他标签页。
只有明确设为常用的笔记本会显示在文档侧栏和文档首页顶部的“常用”区；全部笔记本仍保留在下方的完整分组列表中。
可从笔记本卡片、管理页或笔记本首页设置与取消常用。

## 模块依赖

- `app` 负责跨业务页面组合；`features` 实现业务；`shared` 提供不依赖业务的基础设施和控件。
- `shared` 不导入 `features` / `app`，业务模块不导入 `app`。跨业务组合放在应用层；确有业务协作的 feature 依赖保持显式，不建立覆盖整个项目的公共组件仓库。
- `content/model` 不依赖 React、Tiptap、Konva 或格式组合入口；模型、旧格式转换与 Markdown 导出分别维护。业务通过 `content/blocks.ts` 使用统一接口。
- 数据表字段变更由 `sheets/definition.ts` 统一维护所有视图的相关配置；菜单只呈现选项，工作区控制器执行变更。
- 静态模块依赖不允许循环。仅为类型的依赖不形成运行时循环；动态加载仍检查分层边界。生产代码不导入测试代码。

`npm run check:architecture` 扫描全部生产 TypeScript 模块并运行检查器自身的用例，已纳入 `typecheck` 和 `build`。它约束依赖方向，不替代业务测试，也不判断隐式运行时通信是否合理。新增页面继续使用父布局，不为消除文件长度机械拆分组件。

## 品牌资产

`public/brand/orbis-mark.svg` 与 `orbis-wordmark.svg` 是 Logo 图形和字标的矢量源文件，依据品牌设计稿整理为路径，字标不依赖本机字体。
页面通过 `OrbisLogo` 组件复用这些路径，横版用于登录和初始化页，独立图标用于导航及公开页面的 Orbis 署名；公开站点自己的 Logo 仍由站点配置决定。
浅色背景使用黑色版，深色背景使用反白版，保持比例及图标内置留白。浏览器图标使用独立图形，SVG favicon 随系统明暗主题切换。

修改源文件后，在完整仓库中执行：

```sh
npm run sync:brand
npm run check:brand
npm run export:brand
```

同步命令生成横版、竖版、反白版、应用图标、favicon、README 头图和服务端内嵌图形；构建会校验前端 SVG 资源。
PNG/ICO 导出使用项目锁定的 Playwright 与 Chromium（首次使用需执行 `npx playwright install chromium`），运行时和 Docker 构建直接使用已提交的文件。
`public/brand/` 提供透明 PNG 及 192/512px 应用图标，`public/apple-touch-icon.png` 为 180px，`favicon.ico` 包含 16/32/48px。
仓库社交预览图片位于 `docs/intro/assets/readme/social-preview.png`，可以在 GitHub 仓库的 Social preview 设置中上传；提交图片不会自动修改该设置。

## UI 尺寸与交互规范

通用控件采用 `packages/ui/` 中的官方 shadcn `base-nova` 源码、默认样式和组合 API。页面直接导入 `@orbis/ui/<component>`；产品文案、保存、草稿和确认策略由 feature 或有明确产品职责的 shared pattern 组合。HeroUI、旧控件包装、press 事件翻译及外观兼容样式已退出。

主题使用标准语义角色，如 `bg-background`、`text-foreground`、`bg-primary`、`border-border` 和 `ring-ring`，默认字体为 Geist。应用品牌、正文、画布和网格的专有角色由 `src/styles/brand-tokens.css` 与所属领域维护；普通控件不再借 `--ob-*` 变量复刻旧视觉。样式入口为 `src/styles/globals.css`，具体规则见 [UI 样式契约](packages/ui/docs/styling.md)。

| 原生组件 | 根字号 16px 时的默认尺寸 |
| --- | --- |
| Button | `sm` 28px，默认 32px，`lg` 36px |
| Input / SelectTrigger | 默认 32px |
| 图标按钮 | 按 Button 的 `icon-sm`、`icon`、`icon-lg` 档位 |

这些是原生组件参考值，不是还原旧界面的固定门禁。用 Tailwind 的标准间距、字号和圆角进行实际布局；窄屏允许换行或横向滚动。画布端口、网格行高、触控操作和正文排版由各自领域按真实交互维护，不套用普通表单尺寸。

浮层保留原生焦点约束、Escape 关闭、返回焦点和生命周期，通过明确的 `OverlayScopeProvider` 继承局部阅读主题。Toolbar 成员显式组合 ToolbarButton 等原语；普通 Button 不会自动注册为工具栏成员。图标按钮提供可访问名称，加载状态显式组合 `disabled`、`focusableWhenDisabled`、`aria-busy` 和 Spinner。

动效沿用组件官方实现，应用自己的过渡明确列出属性并由所属布局维护。减少动态效果会取消持续动画和正在进行的过渡；强制颜色模式保留可读内容与可见焦点。验证同时覆盖明暗主题、桌面与窄屏、精细与粗指针、键盘、减少动态效果和强制颜色，不能只用缩窄桌面窗口代替触屏验证。

## 浏览器验收

UI 与生产资源可在无后端的固定 HTTP fixture 下验证：

```sh
npm run test:ui
npm run build
ORBIS_UI_PRODUCTION=1 npm run test:ui -- tests/ui-browser/platform/production-network.spec.ts
```

生产资源检查使用 preview 和实际哈希入口，检查登录、首页、资料、文档和公开阅读器的脚本、样式、字体及图片请求。它不替代后端持久化验收。

```sh
npx playwright install chromium
npm run test:e2e
```

浏览器测试需要 Go 工具链与 Docker。Playwright 调用根目录的 Go 测试启动器，创建独占的 PostgreSQL、Redis 和临时文件目录，显式安装数据库并启动后端；不读取部署 `.env`，不复用日常账号或数据库。
可通过 `ORBIS_E2E_WEB_PORT` 与 `ORBIS_E2E_API_PORT` 调整测试监听端口。


## UI 平台

通用控件使用私有源码包 `@orbis/ui/<component>`，公共入口由 `packages/ui/package.json#exports` 定义，不使用根 barrel 或内部路径。产品文案、草稿与保存策略留在 feature 或 shared/ui pattern。新代码不直接导入 HeroUI、Base UI、Lucide、Radix、Sonner 或 cmdk。

包级契约、主题、表单、可访问名称和浮层规则见 [UI 包文档](packages/ui/README.md)。应用开发路径 `/__ui` 验证页面样式与组合，`npm run storybook` 预览原语状态。`check:ui` 检查依赖与样式所有权，并阻止旧 shared 控件定义、旧导入和退役原生 Props 回流；历史数据编解码、公开链接和领域控件继续由实际业务维护。`node scripts/check-ui.mjs --prune` 只删除已清理的例外，不扩大基线。

验证使用 `npm run typecheck`、`npm run test:run`、`npm run test:storybook`、`npm run test:ui`、`npm run test:a11y`、`npm run storybook:build` 与 `npm run build`。应用 UI 测试在 HTTP 边界提供响应，完整持久化与协作仍须 `test:e2e`。

包体检查 `npm run check:bundle` 比较固定原始构建的 gzip 预算：首屏允许最多 5% 增长；每个 feature 的入口加载边界（entry loading boundary）包含首屏、入口及静态依赖，按实际输出文件去重，允许最多 10% 增长。这个模型不包含额外的 `WorkspaceRoute` 外壳、实际 HTTP 传输或 CSS，不能表述成完整页面的下载量。只能从已校验的原始 manifest 和 artifact 记录推导基线，不改写原始构建数据。协作面板分别测量旧文档、画板、协作文档和 Sheet 四个实际宿主与面板的依赖组合；每个 `(entry, host)` 独立对照原宿主预算，两边都验证完整的动态导入关系。面板 feature 摘要是四个宿主边界的最大值，不代替各场景门禁。公开阅读与预览沿用原模块的入口映射。新增未映射入口、缺失入口、缺失宿主或测量仍阻断检查。

单个 feature-own chunk 与 Reader 家族归属继续输出诊断，不单独作为失败条件；组件拆分后的文件大小不等于页面下载负担。报告另列动态可达依赖的上界，排除主入口的全站路由注册表；这不是一次用户操作的实际下载量。`totalGzipBytes` 只统计 manifest JS，额外发射的 worker JS 单列并计入 `totalEmittedJsGzipBytes`。交付前还需 `npm run check:bundle -- --complete` 验证 manifest JS 总量低于固定基线。报告记录 Node/zlib 版本；gzip 估算用于比较依赖负担，不代表 HTTP 实际协商编码、CPU、缓存命中或交互耗时。

新增/升级依赖或复制代码时，同步 `licenses/npm-manifest.json`、原始许可文本、来源与 `THIRD_PARTY_NOTICES.md`。`licenses:generate -- --check` 可离线检查一致性；`check:licenses` 和 `licenses:bundle dist/licenses` 使用严格发行门禁，待审项不能当作已批准。`licenses/pending-review-summary.json` 和 `licenses/material-gaps.json` 记录真实缺口。
