# 验证

Storybook 只覆盖 UI 原语。Story 的 play 测试在 Vitest browser mode 的 Chromium 中执行，包含 axe 检查。应用业务仍走现有 jsdom 测试，`src/__tests__/types.tsx` 验证类型拒绝错误用法。

应用级 `test:ui` 使用独立 Vite 端口，不需要后端。个人资料用例只替代 HTTP，验证真实页面、请求、草稿、重试版本和会话回写。它不证明后端持久化；完整 `test:e2e` 仍需要仓库指定的 Go/Docker 环境。

生产资源验证先运行 `npm run build`，再执行 `ORBIS_UI_PRODUCTION=1 npm run test:ui -- tests/ui-browser/platform/production-network.spec.ts tests/ui-browser/platform/style-foundation.spec.ts`。该模式通过 Vite preview 检查十五个正式前端路由的已编译入口、脚本、样式和字体均实际加载且同源，以及压缩后 CSS 的嵌套主题、主题根、焦点优先级和系统高对比焦点；HTTP 仍由固定 fixture 提供。其他需要导入 Vite 源模块的 UI 场景继续使用默认开发模式。

焦点回归检查真实绘制结果：普通原生控件使用自己的 ring/border；菜单项与选项使用原生背景高亮并检查文本对比度；系统高对比模式使用共享的系统色轮廓。探针仍拒绝透明/低对比轮廓、低透明度和尚未结束的长动画，不要求所有正常组件叠加同一种旧轮廓。

新增 Base UI 子路径时同步 browser config 的 optimizeDeps.include，避免首次扫描故事时重新预打包导致测试页面重载。包和应用均 dedupe React。

视觉回归使用 Playwright 1.63.0 的 Noble Linux amd64 镜像，固定 digest、Chromium、字体、语言、时区、视口和缩放。运行 `npm run test:visual:container`；容器内及对应 CI job 执行 `npm run test:visual`。主机的 node_modules 使用独立容器卷，截图基线按功能保存在 `tests/visual/snapshots/`。

视觉参考记录新版 UI 的预期表现，不要求与重构前的组件实现保持视觉一致。组件库替换产生的合理变化通过实际布局、主题、可读性和交互检查后更新参考图。

视觉矩阵覆盖浅/深主题与 1280/390px：认证、工作区资料、用户菜单和应用组合；22 个公共组件的代表 Story（含浮层打开态、Button disabled/loading）；首页、文档编辑器、画板、Sheet 与公开阅读器。Storybook 测试等待当前 Story 的 `STORY_FINISHED`，同时拒绝框架缓存的 play/render 错误，再准备截图状态；单独的 success 状态不能证明没有被框架捕获的异常。首页、文档和阅读器走正式前端路由；画板和 Sheet 是真实组件组合，HTTP fixture 场景不代替数据库业务 e2e。

基线来源、覆盖数量及审查范围记录在 `frontend/tests/visual/README.md`。缺失基线会让检查失败。确认设计变更后用 `npm run test:visual:container -- --update-snapshots` 生成候选，逐张检查实际截图、差异及布局数据，再提交相应 PNG。CI 不自动批准或更新基线。本机其他系统的截图和 DOM 测量不能代替 Linux 基线；本机 `--ignore-snapshots` 只验证操作和就绪断言，不证明像素比较通过。
