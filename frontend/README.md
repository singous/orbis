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
- `src/features/`：按产品业务组织；文档编辑器在 `documents/editor/`，通用内容模型和编解码在 `content/model/` 与 `content/codecs/`。
- `src/shared/`：HTTP 客户端、认证、平台适配、导航与 UI 基础组件。
- `src/styles/`：共享样式。
- `tests/e2e/`：浏览器业务旅程与测试辅助代码；单元、组件测试与对应业务源码放在一起。
- `tools/benchmarks/`：编辑器性能测量工具。

内容组件登记由后端 `api/editor-components.json` 维护；`npm run sync:document-blocks` 更新前端副本，构建时检查同步状态。

## UI 尺寸与交互规范

尺寸和动效以 `src/styles/design-tokens.css` 为统一来源，页面优先复用 `src/shared/ui/` 组件。
保留现有 HeroUI 主题及业务布局，新增控件按语义选档位，不在页面中另设一套尺寸。

| 用途 | 默认尺寸 | 变量或组件 |
| --- | --- | --- |
| 紧凑工具栏、图标操作 | 32px | `--orbis-control-compact-height`，`size="sm"` |
| 常规按钮、菜单行 | 36px | `--orbis-control-default-height` |
| 表单输入与选择器 | 40px | `--orbis-control-form-height` |
| 触屏点击区域 | 至少 44×44px | `--orbis-control-touch-height`；粗指针时上述档位统一扩大 |
| 紧凑、常规、导航图标 | 16 / 18 / 20px | `--orbis-icon-*-size` |
| 通用间距 | 4 / 8 / 12 / 16 / 24 / 32 / 48px | `--orbis-space-*` |

这里的 px 是根字号 16px 时的参考值，变量使用 rem，随用户字号缩放。图形尺寸与点击区域分开：
例如颜色圆点保持 24px，外层可交互区域按控件档位扩大。窄屏控件应换行或减少网格列数，不压缩点击区域。

| 动效 | 时长 | 变量 |
| --- | --- | --- |
| 控件状态反馈、小浮层退出 | 120ms | `--orbis-motion-feedback` |
| 菜单与提示进入、弹窗退出 | 180ms | `--orbis-motion-popover` |
| 弹窗及遮罩进入 | 220ms | `--orbis-motion-dialog` |

进入动效共用 `--orbis-ease-out`；弹窗与遮罩同步。明确列出 transition 属性，避免 `transition: all` 或省略属性名；
位移和显隐优先使用 transform/opacity。既有侧栏布局协同动画由 `workspace-sidebar-config.ts` 的常量维护，
不与通用浮层时长混用。尊重 `prefers-reduced-motion`，减少动态效果时保持内容、状态与键盘操作完整。

- 图标按钮必须提供可访问名称；键盘焦点清晰可见，悬停操作也能通过键盘和触屏访问。
- 工作区首个键盘入口可跳转到主内容；弹窗保留焦点约束、Escape 关闭与关闭后的焦点恢复。
- 弹窗使用可视视口高度限制、内部滚动和可换行的操作区；标题与说明允许长文本换行。
- 浮层通过 `--layer-dialog`、`--layer-popover`、`--layer-tooltip` 分层，弹窗中的提示和选择器不能被遮罩覆盖。
- 验证桌面与窄屏、精细与粗指针、明暗主题、键盘和减少动态效果，不能只用缩窄桌面窗口代替触屏验证。

## 浏览器验收

```sh
npx playwright install chromium
npm run test:e2e
```

浏览器测试需要 Go 工具链与 Docker。Playwright 调用根目录的 Go 测试启动器，创建独占的 PostgreSQL、Redis 和临时文件目录，显式安装数据库并启动后端；不读取部署 `.env`，不复用日常账号或数据库。
可通过 `ORBIS_E2E_WEB_PORT` 与 `ORBIS_E2E_API_PORT` 调整测试监听端口。
