# @orbis/ui

Orbis 的私有 source-only UI 包。应用直接使用组件子路径，Vite 编译源码；没有根入口、独立构建、发布或版本发布流程。通用组件采用 shadcn `base-nova` 的默认样式与原生组合 API，业务状态和请求恢复由消费者拥有。

```tsx
import { Button } from "@orbis/ui/button";
import { Input } from "@orbis/ui/input";
import { Spinner } from "@orbis/ui/spinner";

<label>名称<Input name="name" /></label>
<Button type="submit" disabled={saving} focusableWhenDisabled={saving} aria-busy={saving}>
  {saving ? <Spinner aria-hidden="true" /> : null}
  {saving ? "保存中" : "保存资料"}
</Button>
```

当前入口：`button`、`input`、`textarea`、`dialog`、`sheet`、`popover`、`portal`、`dropdown-menu`、`tooltip`、`select`、`radio-group`、`tabs`、`checkbox`、`toggle`、`toolbar`、`toast`、`color-picker`、`avatar`、`badge`、`spinner`、`skeleton`、`icons`、`cn` 和 `styles.css`。Button 的 `render`、复合 Select/Dialog/Avatar、原生事件及上游类型直接可用。旧 shared Button/ActionButton/IconButton/TextInput/SelectField/Tag/Dialog/Tooltip 适配入口由架构检查禁止保留与导入。

样式采用标准 `background`、`foreground`、`primary`、`border`、`ring` 等语义和 Geist 字体。应用品牌、状态及正文/画布/网格角色由自己的主题文件拥有。独立阅读器主题通过显式 OverlayScope 进入原生浮层；Portal 与 Toolbar 保留外部宿主和键盘注册的真实集成能力。应用开发路由 `/__ui` 验证组件与主题组合。

从 `frontend/` 执行：

- `npm run storybook`：交互文档。
- `npm run test:storybook`：真实 Chromium 中的组件行为与 axe 检查。
- `npm run test:ui`：应用样式、Portal 主题与保存契约。HTTP 使用测试响应，不代替后端 e2e。
- `npm run test:types`：应用和 UI 包公共类型。
- `npm run check:ui`：导入边界、公开入口、Story、CSS 所有权与旧接口退出检查。
- `npm run storybook:build`：静态组件文档。

详见[公共 API](docs/authoring.md)、[样式](docs/styling.md)、[浮层](docs/overlays.md)、[表单](docs/forms.md)、[测试](docs/testing.md)、[可访问名称](docs/accessible-names.md)和[依赖维护](docs/dependencies.md)。
