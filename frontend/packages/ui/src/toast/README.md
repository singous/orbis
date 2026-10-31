# Toast

`createToastManager()` 创建独立队列，`ToastProvider` 渲染该队列。挂载前的 add/update/close 会被记录并在 Provider 订阅后重放；更新同一 id 不新增卡片。应用决定队列何时清空，UI 包不依赖路由或登录状态。

通用通知使用非模态 dialog，内容为 polite status；Orbis 产品组合采用 `notificationRole="alertdialog"`，内容按原契约使用 alert。Viewport 不额外重复播报，保持具名通知区域和 F6/Tab 访问。卡片逐条展开，关闭按钮始终可见且可聚焦。

`tone` 显示对应状态图标和可访问的标题颜色，状态同时通过标题/图标表达。默认与 accent 使用信息图标，成功、危险、警告分别使用状态图标；颜色由组件 token 拥有。正文、描述支持换行，不附带业务动作。应用共享入口只允许文字、固定四秒自动关闭，忽略旧的常驻/业务按钮选项。
