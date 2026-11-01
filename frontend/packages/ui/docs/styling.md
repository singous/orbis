# 样式与主题

应用在根样式中导入一次 `@orbis/ui/styles.css`。Tailwind 扫描包源码，排除测试与 Story。包不导入 Tailwind reset；Storybook 在自己的独立文档中导入 Tailwind。

颜色通过 `--ob-*` token 与 `bg-ob-*` 等 utility 使用，圆角通过 `rounded-ob-*` 使用。HeroUI 的运行时和样式依赖已经移除；应用暂存的页面变量别名单向引用平台 token。迁移旧页面 CSS 时仍核对实际像素与颜色，不把名字相近当作视觉一致。

主题以最近的 `data-theme="light|dark"` 为准。每个边界重新绑定语义和组件别名；不引入匹配任意深色祖先的 `dark:` 分支。forced-colors 使用系统颜色并移除阴影；reduced-motion 将包内时长降为 0。旧应用仍有 0.01ms 的全局 reduced-motion 规则，共存期不改变它。

焦点效果由 `styles/utilities.css` 中的 `ob-focus-ring`（focus-visible）和 `ob-input-focus`（focus）统一维护；`internal/focus.ts` 为组件提供这两个名称。业务链接可以直接使用 `ob-focus-ring`，避免复制 outline 规则。组件默认类在前、调用方类在后；`cn` 在 tailwind-merge 的 radius theme 中登记 ob-sm/md/lg/xl，使 rounded-full 等调用方覆盖与反向覆盖按参数顺序生效。新增命名空间圆角时同步这一登记。颜色 token 仍与标准字号、边框宽度分别归类。使用逻辑方向属性。普通页面不增加零散 CSS，内容/画布/网格样式仍由业务拥有。

Base UI 的 --available-width/height、--anchor-width/height、--transform-origin 是浮层定位几何，可在原语内使用；它们不属于主题变量。其他第三方主题变量仍被架构门禁拒绝。


平台样式不依赖 HeroUI。应用通过 `globals.css` 导入平台样式和应用品牌角色；通用变量直接使用 `--ob-*`，旧变量桥已移除。内容、编辑器和网格的保留样式由实际模块导入，并在领域样式清单中限定入口与根作用域。`--ob-page-*` 仅保留这些已存在的页面状态/文案颜色以避免本次换库改版；新控件使用正常的 foreground、danger-text 等语义。画布底色、表面层级、边缘与卡片阴影使用共享的 canvas/surface-secondary/surface-edge/shadow-card 角色。


组件的 caption 使用 `text-ob-caption`（12px/18px），应用旧 caption 变量仅引用同一值，避免全局 `text-xs` 主题改写使渲染契约漂移。大头像沿用应用实际的 16px/24px。Storybook 独立加载与应用同一份本地 Inter 字体，并为 body（含 Portal）提供相同的 UI 基础排版；不导入应用页面样式来补组件契约。
