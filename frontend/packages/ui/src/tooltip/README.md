# Tooltip

采用 shadcn base-nova 的原生 `TooltipProvider`、`Tooltip`、`TooltipTrigger` 和 `TooltipContent` 组合。应用提供一次 Provider；原生 Provider 默认 delay 为 0，需要延迟的界面显式传递 `delay`。

Trigger 通过 `render` 组合链接或按钮，保留它们原有的语义、事件与 ref。提示内容使用 `role=tooltip`。每个实例的 React ID 默认把 Trigger 的 `aria-describedby` 关联到 Content 的 `id`，显式原生属性可以覆盖这些默认值；打开、关闭与定位仍交给 Base UI。图标按钮仍须提供自己的可访问名称。

普通消费者直接使用这些组件；不再提供旧的 `label/children`、`delayMs` 或 `asChild` 适配。局部发布主题通过应用的 overlay scope 提供 Portal HTML 属性，组件的标准 API 和默认外观保持不变。
