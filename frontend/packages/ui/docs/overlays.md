# 浮层契约

Dialog 使用 Base UI 的焦点约束、滚动锁、外部点击与 Escape 生命周期。标题必填，描述可选，默认保留关闭按钮。受控调用方通过 `onOpenChange` 决定是否接受关闭，例如在途提交期间忽略 `false`；关闭动画不要求调用方提前清空表单草稿。

DialogTrigger 和 DialogClose 可以通过 `asChild` 与 Button 组合，避免嵌套按钮。受控且无 Trigger 的弹窗可通过 `finalFocus` 指向返回位置。

Portal 挂到 body，但通过隐藏锚点读取打开位置最近的 data-theme。读取锚点的全部 `--ob-*` 解析值，并在 Portal 根复制，保留局部主题覆盖。祖先的主题、class、style 属性变化和 forced-colors/reduced-motion/pointer 媒体变化会重新取值；卸载时清理订阅。普通任意业务 CSS 变量不进入 UI 平台的继承契约。

层级使用 token：Dialog 80、Select/Popover 90、Tooltip 100。嵌套 Select 的第一次 Escape 只关闭列表并恢复触发器焦点，第二次关闭 Dialog 并返回外部触发器。对应 Story 和应用级浏览器用例覆盖这些行为。

Select 的 body Portal 使用具名选项区域，让浮层文本在完整页面的地标导航中可定位；内部 listbox/option 继续由 Base UI 管理。
