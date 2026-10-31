# 样式与主题

应用在根样式中导入一次 `@orbis/ui/styles.css`。Tailwind 扫描包源码，排除测试与 Story。包不导入 Tailwind reset；Storybook 在自己的独立文档中导入 Tailwind。

颜色通过 `--ob-*` token 与 `bg-ob-*` 等 utility 使用，圆角通过 `rounded-ob-*` 使用。旧 HeroUI token 和样式顺序继续保留；迁移时核对实际像素与颜色，不把名字相近当作视觉一致。

主题以最近的 `data-theme="light|dark"` 为准。每个边界重新绑定语义和组件别名；不引入匹配任意深色祖先的 `dark:` 分支。forced-colors 使用系统颜色并移除阴影；reduced-motion 将包内时长降为 0。旧应用仍有 0.01ms 的全局 reduced-motion 规则，共存期不改变它。

焦点规则由 `internal/focus.ts` 维护；文本输入使用 focus，其他按钮使用 focus-visible。组件默认类在前、调用方类在后；`cn` 在 tailwind-merge 的 radius theme 中登记 ob-sm/md/lg/xl，使 rounded-full 等调用方覆盖与反向覆盖按参数顺序生效。新增命名空间圆角时同步这一登记。颜色 token 仍与标准字号、边框宽度分别归类。使用逻辑方向属性。普通页面不增加零散 CSS，内容/画布/网格样式仍由业务拥有。
