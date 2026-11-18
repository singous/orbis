# Toast

采用 shadcn base-nova 的原生 `Toaster`、Toast 组合、`createToastManager`、`toast` 和 `useToastManager`。普通界面通过 `Toaster toastManager={manager}` 提供原生 Provider 与可见通知列表；需要自定义组合时使用 Provider、Portal、Viewport 和内容组件。

原生 manager 提供 `add`、`update`、`close`、`promise`；`close()` 不带 id 关闭全部通知。它同步向已订阅的 Provider 发送事件，不为挂载前调用建立队列。Orbis 启动前排队、会话切换清理和业务 `showToast` 门面属于应用层，不重建为 UI 包的旧 manager 协议。

使用原生 `type` 表达 success/error/warning/info/loading，`priority` 决定辅助技术播报。默认低优先级通知为非模态 dialog；高优先级通知在未聚焦时由原生机制隐藏可视根并另行播报。关闭控件在通知展开或自身聚焦时进入可访问树。

Base UI 1.9.0 存在[隐藏 Toast/Close 仍留在 Tab 顺序中的缺陷](https://github.com/mui/base-ui/issues/5659)。Root、Close 在原生 render 输出上使用一个薄焦点适配：当前节点或 Toast 祖先隐藏时把 tabIndex 设为 -1；真实焦点进入时暴露当前节点，离开后交还原生隐藏状态。使用官方 `useRender` 保留调用方的 render、事件、ref 和内容；Action 直接沿用原生 render，仅在 Root 隐藏时退出 Tab 顺序。不镜像开关状态，不改变优先级或公告机制。

F6 聚焦原生通知区域，Tab 依次到通知根、可选 Action 和 Close；Shift+Tab 从区域返回先前操作。隐藏初始状态以全页 axe 验证，不先聚焦或等待通知消失。F6 后原生焦点哨兵会短暂接住 Tab 并同步重定向；这是[上游明确的预期行为](https://github.com/mui/base-ui/issues/4668)。只有该状态的检查局部排除 `[data-base-ui-focus-guard]`，并另验证 Tab 不停留在哨兵；不关闭 aria-hidden-focus 规则。

组件默认样式与 API 保持官方来源。中文通知区域和关闭标签、应用的 overlay scope 与上述可访问性适配均在 registry 中记录。
