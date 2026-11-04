# Portal

Orbis 的领域集成组件用于编辑器菜单和稳定嵌入宿主。它保持来源主题与 React 子树身份，不提供旧控件 API 或外观。

```tsx
import { Portal, readPortalTheme } from "@orbis/ui/portal";

<Portal container={host}>{menu}</Portal>
```

`container` 是业务提供的 `Element` 或 `DocumentFragment`。把同一宿主在原位置与 body 之间移动会保留 Portal 子 DOM、组件状态和草稿；更换 container 则可能重建子树。

来源 anchor 订阅实际主题。目标 `data-slot="portal"` 包装使用 `display: contents`，带最近的 data-theme 和标准 shadcn 主题变量、实际字体，以及仍有领域消费者的 `--ob-*`/`--reading-*` 变量。祖先主题、class、style 和已有媒体查询的变化会更新快照。OverlayScopeProvider 将同一份 HTML scope 传给该子树打开的原生浮层。

null、undefined 和 boolean children 不向目标创建内容，保留依靠 `:empty` 隐藏的宿主行为。Portal 不创建或结束隐式 Toolbar 注册层：只有显式 ToolbarButton 等原语参与工具栏，普通浮层 Button 不会注册。位置、角色、可访问名称、焦点和关闭策略由业务或原生浮层组件负责。

`readPortalTheme(element)` 返回同一份一次性快照，供原生拖动预览等领域场景使用；调用者负责宿主的生命周期。Props 直接通过 `ComponentProps<typeof Portal>` 获取，不保留旧的重复 Props 类型。
