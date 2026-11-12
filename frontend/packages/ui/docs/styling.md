# 样式与主题

应用通过 `src/styles/globals.css` 先导入 Tailwind，随后导入一次 `@orbis/ui/styles.css`。Tailwind 扫描 UI 包源码并排除测试与 Story。包的样式入口声明 `theme, base, components, utilities` 层级，依次导入 tokens、accessibility、公共 utility 和 ColorPicker 样式；tokens 文件导入官方的 `tw-animate-css`、`shadcn/tailwind.css` 与本地 Geist 字体。Storybook 使用相同顺序，确保 UI 的 base 默认边框在 Tailwind preflight 之后生效。普通焦点回退归入 base 层，组件与调用方的 utilities 天然优先。

通用控件直接使用官方 shadcn 默认类和标准语义：`bg-background`、`text-foreground`、`bg-primary`、`text-muted-foreground`、`border-border`、`ring-ring` 等。圆角与尺寸采用官方默认值。`cn` 使用原生实现所需的 `cn` 包并从 `@orbis/ui/cn` 重新导出；不再注册旧的 `ob-*` Tailwind merge 扩展。默认组件类与调用方类的组合保持上游行为。

标准浅/深色变量在 `styles/tokens.css` 中保留上游 neutral 角色表。另一个有注释的 base 块只修正浅色 `--destructive`（明度 0.577 → 0.46）与 `--ring`（0.708 → 0.55），供危险操作文本和焦点边框通过实际对比度检查。普通组件的默认类不因此改变；这两处差异属于明确的可访问性补丁。

局部 `data-theme="light|dark"` 与没有显式 data 属性的 `.light` / `.dark` 是实际主题边界；显式 data 属性优先。深色变体使用有边界的 CSS scope，允许浅/深色嵌套和阅读器独立主题。`scripts/theme-scopes.ts` 在 PostCSS 阶段把 Tailwind 生成的 scope 提到 utility selector 外，同时保留控件 selector 与状态/media 条件，避免把主题根误当成控件。应用和 Storybook 都使用这一个插件，并停用先于 PostCSS 的 Tailwind 内部优化；Vite 的生产 CSS 压缩继续保留。Node 编译回归及开发/生产浏览器测试验证选择器、主题根和嵌套边界。

`OverlayScopeProvider` 将主题边界显式传给挂到 body 的浮层。UI 默认字体为 Geist；应用另保留的 Inter 资源用于既有内容字体，不改变通用组件的默认字体。

应用的 `brand-tokens.css` 当前拥有正文、画布、网格、用户身份色等 `--ob-*` 领域角色，以及 `--status-success*`、`--status-warning*`、`--destructive-soft`、`--shadow-color` 状态角色。状态角色可引用该文件准许的 Tailwind 调色板来源。架构检查拒绝该文件重定义 `--primary` 等基础标准角色或其 Tailwind 映射，避免悄悄覆盖 shadcn。普通控件通过原生 variant/size 表达状态，不再借领域角色复刻旧外观；业务不把原始色值散落在 TSX 或无主 CSS 中。需要用户输入颜色、图表数据颜色等真实数据时，遵循现有的有来源、有限次数的数据例外。

`styles/accessibility.css` 在 base 层限制居中 Dialog 的高度为 `100dvh - 2rem` 并允许纵向滚动，防止长内容在短屏幕中遮住关闭按钮；调用方的布局 utility 仍可提供自己的滚动区域。forced-colors 角色映射也在 base 层。普通原生焦点回退在 base 层，原生组件的焦点类与调用方显式状态类保持可覆盖。系统高对比焦点轮廓与 reduced-motion 单独位于 utilities 层。公共 `focus-ring` 使用标准 `--ring`；未使用的 `input-focus` 已移除。

应用全局仅保留根最小宽度与通知层级；滚动条规则也归入 base 层。组件布局写在拥有组件中。正文、编辑器、画布和网格的保留 CSS 通过领域样式清单限定实际导入者和根作用域。这些领域内容仍需样式与数据色，不应描述成整个应用没有任何 CSS。Orbis 品牌组件库应作为后续明确的品牌工作实施。

Base UI 的 `--available-width`、`--available-height`、`--anchor-width`、`--anchor-height`、`--transform-origin` 与 Toast 几何变量用于定位和堆叠，不是第三方主题。架构检查准许这些原生能力、标准主题和局部定义的变量，并拒绝无所有者的外来主题变量与 CSS 导入。

颜色对比与键盘焦点由真实浏览器和 axe 验证。共享样式在应用和 Storybook 中都尊重 forced-colors 系统颜色，并在 reduced-motion 下停用动画和过渡。
