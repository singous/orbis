# Popover

Popover/Trigger/Content/Close 组成一个非模态浮层。受控与非受控打开状态互斥；需要焦点约束时由消费者显式选择 modal。

Content 自己是 dialog，提供 aria-label 命名。side/align/sideOffset 属于外层 Positioner，className/style 属于内层 Popup；现有页面若带绝对 top/left/right 定位，要在迁移该 surface 时移除旧定位，不能把旧偏移叠到新定位上。

初始焦点默认由 Base UI 移入内容；finalFocus 默认返回触发器。仅附加行为的 Close 不重复提供焦点样式，可与 Button 组合。Portal 挂 body 并继承打开位置主题/token，避免被业务滚动容器裁剪。

工作空间切换选择器使用该原语，但加载、保存前检查、取消控制器、会话隔离和路由跳转仍由 workspace 拥有。
