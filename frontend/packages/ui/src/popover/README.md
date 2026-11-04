# Popover

采用 shadcn base-nova 的原生 `Popover`、`PopoverTrigger`、`PopoverContent`、`PopoverHeader`、`PopoverTitle` 和 `PopoverDescription`。Trigger 使用 `render` 组合按钮；内容按原生 `side/align/sideOffset/alignOffset` 定位。

需要显式关闭的业务由自己的受控 `open/onOpenChange` 状态处理，不保留旧的 `PopoverClose` 适配。Popup 的可访问名称、初始焦点和关闭后返回焦点使用 Base UI 原生属性。

工作区切换器的加载、保存前检查、取消控制器、会话隔离和导航仍由 workspace 负责。局部主题通过 overlay scope 提供，不由组件重建旧样式或推测业务 DOM。
