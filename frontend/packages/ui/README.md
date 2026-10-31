# @orbis/ui

Orbis 的私有 source-only UI 包。应用直接使用组件子路径，Vite 编译源码；没有根入口、独立构建、发布或版本发布流程。

```tsx
import { Button } from "@orbis/ui/button";
import { Input } from "@orbis/ui/input";

<label>名称<Input name="name" /></label>
<Button type="submit" loading={saving}>保存资料</Button>
```

当前入口：`button`、`input`、`textarea`、`dialog`、`select`、`avatar`、`badge`、`spinner`、`skeleton`、`icons`、`cn` 和 `styles.css`。这些组件仍处于试点阶段，不能据此全局替换旧共享入口。个人资料页是首个真实消费者；应用开发路由 `/__ui` 验证样式与主题组合。

从 `frontend/` 执行：

- `npm run storybook`：交互文档。
- `npm run test:storybook`：真实 Chromium 中的组件行为与 axe 检查。
- `npm run test:ui`：应用样式、Portal 主题与个人资料保存契约。HTTP 使用测试响应，不代替后端 e2e。
- `npm run test:types`：应用和 UI 包公共类型。
- `npm run check:ui`：导入边界、公开入口、Story 和新增存量违规检查。
- `npm run storybook:build`：静态组件文档。

详见 [公共 API](docs/authoring.md)、[样式](docs/styling.md)、[浮层](docs/overlays.md)、[表单](docs/forms.md)、[测试](docs/testing.md)和[可访问名称](docs/accessible-names.md)。
