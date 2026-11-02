# 可访问名称

有可见文字时优先由文字形成名称。原生 Button 直接渲染内容，不再为每个按钮包裹旧 label 节点或自动生成 aria-labelledby。纯图标操作提供 `aria-label`；复杂组合需要关联文本时由业务显式设置 `aria-labelledby`，不要覆盖有意义的可见文案。

装饰图标与和文字重复的 Spinner 使用 `aria-hidden`。独立 Spinner 默认带有“加载中”状态名称；消费者可通过标准属性改名或隐藏。Dialog 通过 DialogTitle 和 DialogDescription 关联名称与描述。Select 的可见 label 关联 SelectTrigger，列表选项由 SelectItem 中的文本命名。

TooltipTrigger 的默认 `aria-describedby` 对应同实例 TooltipContent 的 id；内容带 `role="tooltip"`，显式 id、role 和 ARIA 属性仍可覆盖。不同实例使用独立 id。Tooltip 是补充描述，不能代替纯图标按钮自己的操作名称。

Toast 保留原生优先级与公告机制。高优先级通知由辅助技术公告区域宣读，视觉根节点在相应状态下可能 aria-hidden；不要为测试强行修改原生隐藏逻辑或重复设置 alert。通知视口和关闭控件提供本地化名称，业务的错误恢复仍由实际表单或操作入口提供。

针对 Base UI 1.9.0 的实际隐藏焦点缺陷，Toast 的 Root、Action、Close 在隐藏时退出 Tab 顺序，真实聚焦时暴露当前节点，并在离开后交还原生状态；详情见 [Toast](../src/toast/README.md)。初始未聚焦状态保留全页 axe。只有 F6 后原生同步重定向的焦点哨兵做局部排除，同时验证真实 Tab 不停留在哨兵，不豁免通知节点或整个 aria-hidden-focus 规则。

新交互在 Story 中验证实际 role、名称、描述关联和键盘行为。axe 设置为 error，不能通过关闭对比度规则或修改可见性绕过真实问题。当前危险色依据真实 Chromium 的默认组件对比度检查调整。
