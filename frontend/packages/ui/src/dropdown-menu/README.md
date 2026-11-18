# DropdownMenu

采用 shadcn base-nova 原生组件和 Base UI 菜单属性，包括普通项、checkbox/radio 项、分组、分隔线与子菜单。Trigger 和链接项通过原生 `render` 组合；动作使用 `onClick`，文字检索使用 `label`。

`closeOnClick`、`disabled`、`checked/onCheckedChange`、`value/onValueChange` 等保留原生语义。需要持续打开的选择菜单显式传递 `closeOnClick={false}`。不提供旧的 `asChild`、`textValue` 或 `onSelect` 动作协议。

Portal 默认样式与 API 采用官方来源；应用只通过 overlay scope 补充局部主题 HTML 属性。保存、删除、路由导航与操作失败处理属于业务消费者。
