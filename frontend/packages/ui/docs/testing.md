# 验证

Storybook 只覆盖 UI 原语。Story 的 play 测试在 Vitest browser mode 的 Chromium 中执行，包含 axe 检查。应用业务仍走现有 jsdom 测试，`src/__tests__/types.tsx` 验证类型拒绝错误用法。

应用级 `test:ui` 使用独立 Vite 端口，不需要后端。个人资料用例只替代 HTTP，验证真实页面、请求、草稿、重试版本和会话回写。它不证明后端持久化；完整 `test:e2e` 仍需要仓库指定的 Go/Docker 环境。

新增 Base UI 子路径时同步 browser config 的 optimizeDeps.include，避免首次扫描故事时重新预打包导致测试页面重载。包和应用均 dedupe React。

视觉回归使用 Playwright 1.63.0 的 Noble Linux amd64 镜像，固定 digest、Chromium、字体、语言、时区、视口和缩放。运行 `npm run test:visual:container`；容器内及对应 CI job 执行 `npm run test:visual`。主机的 node_modules 使用独立容器卷，截图基线按功能保存在 `tests/visual/snapshots/`。

当前场景覆盖浅/深主题与 1280/390px 下的认证、工作区资料、用户菜单、表单、Dialog 和 Select。首次基线仍需在该 Linux 镜像生成并逐张审查；缺失基线会让检查失败。确认设计变更后用 `npm run test:visual:container -- --update-snapshots` 生成候选，检查实际截图、差异及布局数据，再提交相应 PNG。CI 不自动批准或更新基线。本机其他系统的截图和 DOM 测量不能代替 Linux 基线，HTTP fixture 场景也不代替业务 e2e。
