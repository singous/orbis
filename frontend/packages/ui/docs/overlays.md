# 浮层契约

Dialog 使用 Base UI 的焦点约束、滚动锁、外部点击和 Escape 生命周期。标准组合为 Dialog、DialogTrigger、DialogContent、DialogHeader、DialogTitle、DialogDescription 和 DialogFooter；标题与描述直接作为子组件渲染。DialogContent 默认包含关闭按钮，`showCloseButton={false}` 可由业务隐藏。Sheet、Popover、Select、DropdownMenu 与 Tooltip 同样采用各自的官方组合 API，不再使用旧的 DialogPopup、字符串 title/description 或 asChild 兼容层。

触发器与关闭控件使用 `render={<Button />}` 组合，避免嵌套按钮。DialogContent 的 `initialFocus` 与 `finalFocus` 使用上游属性；无稳定 Trigger、或从会卸载的菜单打开时，由业务将 `finalFocus` 指向稳定返回位置。不要同时用字段的原生 `autoFocus` 抢先改变焦点记录。嵌套 Select 关闭后先回到选择触发器，Dialog 关闭后再回到外部触发器。

在途提交可用 Dialog 的 `disablePointerDismissal` 禁止背景关闭，并在 `onOpenChange(open, details)` 中对不接受的关闭调用 `details.cancel()`。关闭按钮和取消操作的禁用状态、保存结果、草稿与恢复路径由业务拥有者管理。`onOpenChangeComplete` 在对应进出动画完成后通知；需要等退出完成再卸载草稿或恢复编辑选区时使用此回调，不用固定毫秒数猜测退场。

通用浮层默认使用原生 Portal 和官方布局。DialogPortal、DropdownMenuPortal、ToastPortal 等公开的 Portal 继续接受标准属性，显式调用方属性优先。PopoverContent、SelectContent、TooltipContent 等内部 Portal 同样读取应用显式提供的主题范围，不扫描业务 DOM 来推测旧控件主题。

独立主题由 `@orbis/ui/portal` 的 `OverlayScopeProvider` 提供。value 可含 `data-theme`、`className` 和 `style`；原生浮层将其传到 Portal 根。需要独立深色变体时一并提供 `data-theme="dark"` 与 `className="dark"`，局部标准变量通过 style 传入。value 变化会直接更新浮层；未提供 Provider 时不增加额外范围。应用的阅读器拥有实际主题元素，可用 `useElementTheme` 获取其标准主题、`--ob-*` 和 `--reading-*` 已解析值，再传入 Provider。

外部 DOM 宿主或拖动预览使用 `@orbis/ui/portal` 的 Portal，而非给 DialogContent 加旧 `portalContainer` 属性。Portal 接收 `Element | DocumentFragment`，以 `display: contents` 包装内容，保留逻辑位置的主题锚点与局部变量，并向嵌套原生浮层提供 OverlayScope。空内容不创建目标包装；同一个宿主被移动时保留子树身份。焦点、定位、关闭与宿主生命周期由消费者管理。`readPortalTheme(element)` 可为不走 React 的原生拖动预览获取一次主题快照。

Toolbar 成员仅由显式 ToolbarButton 等原语注册，Portal 不负责隐式切换工具栏范围。浮层正文中的普通 Button 不注册到背后的工具栏。

原生浮层使用官方 z-50 层级。应用通知视口使用全局 z-index 60，以便操作失败提示显示在仍打开的业务弹窗上方；需要其他层级时在实际拥有者中处理，并验证焦点、滚动与嵌套关闭行为。
