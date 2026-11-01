# ConfirmAction

在用户明确确认后执行一次危险操作，统一提供取消入口、在途关闭限制和失败反馈。操作内容、权限、草稿与请求参数由业务拥有者决定。

`children` 必须是单个能接收按钮属性和 ref 的 React 元素。`disabled` 只禁用确认操作，不会自动禁用这个触发元素；需要同时禁止打开时，像下面一样把状态传给触发按钮。

## 让放弃修改先经过确认

```tsx
import { Button } from "@/shared/ui/Button";
import { ConfirmAction } from "@/shared/ui/ConfirmAction";

export function DiscardDraftAction({ onDiscard, busy }: {
  onDiscard: () => void | Promise<void>;
  busy: boolean;
}) {
  return <ConfirmAction
    title="放弃本次修改"
    description="未保存的修改将被清除。需要保留时，请先导出本机修改。"
    confirmLabel="确认放弃"
    disabled={busy}
    onConfirm={onDiscard}
  >
    <Button disabled={busy}>放弃本次修改</Button>
  </ConfirmAction>;
}
```

`onDiscard` 来自业务拥有者，负责实际放弃操作。返回 Promise 时应直接返回或等待它，让弹窗能够识别完成和失败；不要在回调中吞掉错误后正常返回，也不要用 `void` 丢弃 Promise。业务需要先处理错误时，处理后仍须抛出该失败。

## 传入操作和文案

| Prop | 类型 | 必填 / 默认值 | 行为 |
| --- | --- | --- | --- |
| `children` | `ReactElement` | 必填 | 作为 `DialogTrigger asChild` 的单个触发元素，通常使用共享 `Button`。 |
| `title` | `string` | 必填 | 确认框的可访问名称和可见标题。 |
| `description` | `string` | 必填 | 描述操作影响，并关联为确认框的可访问描述。 |
| `confirmLabel` | `string` | 必填 | 确认按钮文案。 |
| `onConfirm` | `() => void \| Promise<void>` | 必填 | 只在明确确认且未禁用、未执行时调用。正常返回或 Promise fulfilled 后关闭。 |
| `disabled` | `boolean` | `false` | 禁用确认按钮，并阻止执行回调；不向 `children` 透传。 |

## 处理关闭、焦点与失败

打开的是 `alertdialog`，初始焦点落在“取消”。点击外部始终不会关闭；空闲时可用“取消”或 Escape 关闭，均不执行 `onConfirm`。焦点约束和关闭后的触发器焦点恢复由 UI 包的 Dialog 承担；保留触发元素，才能返回该位置。

确认后立即阻止重复调用，并在等待回调时禁用“取消”和确认按钮，阻止 Escape 等关闭请求。回调成功后关闭；抛出异常或 Promise rejected 时保持打开、恢复操作入口，并通过现有 `reportError` 报告错误。已由请求反馈入口处理的同一错误不会重复提示；这里只保留重试入口，不自动再次执行。

组件只拥有弹窗开关和这次确认的执行状态。草稿保存或删除、操作 ID、并发版本、回执和请求生命周期仍由回调所属业务处理；取消确认不调用业务撤销，也不改变草稿。若成功后业务移除整个组件，后续焦点位置由所属页面安排。

## 查看实现与验证

- [组件实现](./ConfirmAction.tsx)和[共享按钮](./Button.tsx)定义实际 Props 与执行边界。
- [行为测试](./DraftActions.test.tsx)覆盖取消不执行、初始取消焦点、在途防重复与 Escape 限制，以及失败保持打开且请求错误只提示一次。
- [表格工作区](../../features/sheets/SheetWorkspace.tsx)同时禁用触发器与确认操作；[画板编辑器](../../features/boards/BoardEditor.tsx)由 session 负责放弃和重新读取。
- 需要将确认入口放进草稿工具时，参见 [DraftActions](./DraftActions.README.md)。通用焦点、主题和浮层约定见 [UI 包浮层契约](../../../packages/ui/docs/overlays.md)。

从 `frontend/` 执行现有用例：`npm run test:run -- src/shared/ui/DraftActions.test.tsx`。
