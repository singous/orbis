# 验证

Storybook 只覆盖 UI 原语。Story 的 play 测试在 Vitest browser mode 的 Chromium 中执行，包含 axe 检查。应用业务仍走现有 jsdom 测试，`src/__tests__/types.tsx` 验证类型拒绝错误用法。

应用级 `test:ui` 使用独立 Vite 端口，不需要后端。个人资料用例只替代 HTTP，验证真实页面、请求、草稿、重试版本和会话回写。它不证明后端持久化；完整 `test:e2e` 仍需要仓库指定的 Go/Docker 环境。

新增 Base UI 子路径时同步 browser config 的 optimizeDeps.include，避免首次扫描故事时重新预打包导致测试页面重载。包和应用均 dedupe React。

视觉截图基线需要固定 Chromium、字体、视口及操作系统。当前 DOM、布局与状态检查不能替代方案要求的完整页面视觉基线；建立稳定 CI 环境后再录入，不自动接受差异。
