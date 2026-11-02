# 样式与主题

应用通过 `src/styles/globals.css` 导入一次 `@orbis/ui/styles.css`。Tailwind 扫描 UI 包源码并排除测试与 Story。包的样式入口拥有 tokens、少量公共 utility 和 ColorPicker 样式；tokens 文件导入官方的 `tw-animate-css`、`shadcn/tailwind.css` 与本地 Geist 字体。Storybook 在自己的入口导入 Tailwind 和同一份 UI 样式。

通用控件直接使用官方 shadcn 默认类和标准语义：`bg-background`、`text-foreground`、`bg-primary`、`text-muted-foreground`、`border-border`、`ring-ring` 等。圆角与尺寸采用官方默认值。`cn` 使用原生实现所需的 `cn` 包并从 `@orbis/ui/cn` 重新导出；不再注册旧的 `ob-*` Tailwind merge 扩展。默认组件类与调用方类的组合保持上游行为。

标准浅/深色变量在 `styles/tokens.css` 中定义；局部 `data-theme="light|dark"` 是实际主题边界，深色变体使用有边界的 CSS scope，允许阅读器在深色工作区中独立保持浅色。`OverlayScopeProvider` 将这一边界显式传给挂到 body 的浮层。UI 默认字体为 Geist；应用另保留的 Inter 资源用于既有内容字体，不改变通用组件的默认字体。

应用的 `brand-tokens.css` 拥有品牌、正文、画布、网格等 `--ob-*` 角色，以及 `--status-success*`、`--status-warning*`、`--destructive-soft`、`--shadow-color` 状态角色。状态角色可引用该文件准许的 Tailwind 调色板来源。普通控件不再借这些角色复刻旧基础组件外观；业务不把原始色值散落在 TSX 或无主 CSS 中。需要用户输入颜色、图表数据颜色等真实数据时，遵循现有的有来源、有限次数的数据例外。

公共 `focus-ring` 和 `input-focus` utility 使用标准 `--ring`。通用控件保留自己的默认焦点样式；业务的原生控件可使用这些 utility。应用全局只承载根布局、原生焦点、forced-colors、reduced-motion 和通知层级等全局规则，组件布局写在拥有组件中。正文、编辑器、画布和网格的保留 CSS 通过领域样式清单限定实际导入者和根作用域。

Base UI 的 `--available-width`、`--available-height`、`--anchor-width`、`--anchor-height`、`--transform-origin` 与 Toast 几何变量用于定位和堆叠，不是第三方主题。架构检查准许这些原生能力、标准主题和局部定义的变量，并拒绝无所有者的外来主题变量与 CSS 导入。

颜色对比与键盘焦点由真实浏览器和 axe 验证。危险色的浅色明度依据默认 destructive 变体的实际对比度调低；组件默认类仍保留官方实现。应用尊重 forced-colors 系统颜色，并在 reduced-motion 下停用动画和过渡。
