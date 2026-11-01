# 浮层契约

Dialog 使用 Base UI 的焦点约束、滚动锁、外部点击与 Escape 生命周期。标题必填，描述可选，默认保留关闭按钮。在途提交通过 `dismissible={false}` 阻止 Escape、关闭按钮和外部点击引发的关闭；业务完成后仍可显式设置 `open={false}`。仅在受控回调里忽略 `false` 不能阻止原语开始退场，因此原有关闭 guard 仍保留，但关闭策略也必须传给 Dialog。关闭动画不要求调用方提前清空表单草稿。

DialogTrigger 和 DialogClose 可以通过 `asChild` 与 Button 组合，避免嵌套按钮。受控且无 Trigger 的弹窗可通过 `finalFocus` 指向返回位置。

Portal 挂到 body，但通过隐藏锚点读取打开位置最近的 data-theme。读取锚点的全部 `--ob-*` 解析值，并在 Portal 根复制，保留局部主题覆盖。祖先的主题、class、style 属性变化和 forced-colors/reduced-motion/pointer 媒体变化会重新取值；卸载时清理订阅。普通任意业务 CSS 变量不进入 UI 平台的继承契约。

独立宿主或原生浮层使用 `@orbis/ui/portal` 的 `Portal`，由调用方传 `Element | DocumentFragment` 容器。它保留逻辑位置的隐藏主题锚点，在目标以 `display: contents` 包装内容并结束外层 Toolbar 范围，不增加布局盒。空内容不创建目标包装，保留 `:empty` 布局；移动同一个容器保留子树身份。焦点、定位、关闭与容器生命周期由所属消费者管理。原生拖动预览可调用同一入口的 `readPortalTheme(element)`，在挂载前应用一次 `theme` 与 `portalStyle` 快照，不复制包内 hook。

层级使用 token：Dialog 80、Select/Popover 90、Tooltip 100。嵌套 Select 的第一次 Escape 只关闭列表并恢复触发器焦点，第二次关闭 Dialog 并返回外部触发器。对应 Story 和应用级浏览器用例覆盖这些行为。

Select 的 body Portal 使用具名选项区域，让浮层文本在完整页面的地标导航中可定位；内部 listbox/option 继续由 Base UI 管理。

搜索等具有独立 chrome 的场景使用 DialogPopup + DialogTitle + DialogClose 组合。DialogPopup 负责 Portal、背景、视口和焦点，不额外插入标题区或关闭图标；调用方必须通过 DialogTitle 或 aria-label 提供名称，并渲染关闭控件。backdropClassName 和 viewportClassName 用于浮层布局，不允许业务直接依赖 Base UI 的 DOM 结构。

Dialog 的 onOpenChangeComplete(open) 在对应进入/退出动画完成后通知。需要保留草稿、恢复编辑选区或卸载会话时使用该回调，不根据固定毫秒数推测退场。搜索拥有者继续在实际退出后等待焦点恢复帧，再还原原来的选区与滚动位置；较早请求的退出回调不能关闭新打开的会话。

危险操作确认可以通过 dismissOnOutsidePress={false} 禁止点击背景关闭；显式取消、Escape 和受控关闭是否接受，仍由相应原语和业务拥有者负责。

公开阅读器等拥有独立品牌变量的边界可给 DialogPopup 传 portalContainer DOM 或 ref，使浮层实际挂载在该主题子树中。该容器保留 --reader-* 等领域变量的原有继承，不把它们加入通用 UI 包的复制协议；initialFocus/finalFocus 仍由浮层原语负责。
