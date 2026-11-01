# DraftActions

把业务提供的草稿重试、导出或恢复操作放进用户主动打开的弹窗。组件只拥有工具入口和非受控弹窗；业务决定何时显示、提供哪些操作，以及操作完成后的显示状态。

## 显示本机修改的处理入口

```tsx
import { reportError } from "@/shared/api/request-feedback";
import { Button } from "@/shared/ui/Button";
import { DraftActions } from "@/shared/ui/DraftActions";

export function LocalDraftTools({ hasPending, busy, onRetry, onExport }: {
  hasPending: boolean;
  busy: boolean;
  onRetry: () => Promise<void>;
  onExport: () => void;
}) {
  if (!hasPending) return null;
  return <DraftActions label="表格本机修改">
    <Button disabled={busy} onClick={() => void onRetry().catch(reportError)}>
      重试保存
    </Button>
    <Button onClick={onExport}>导出本机修改</Button>
  </DraftActions>;
}
```

示例中的 `hasPending`、`busy`、`onRetry`、`onExport` 来自业务拥有者；传给 `DraftActions` 的只有 `label` 和 `children`。重试回调负责实际保存，示例通过现有反馈入口处理失败；导出回调负责生成和下载业务数据。

## 组织工具内容

| Prop | 类型 | 必填 / 默认值 | 行为 |
| --- | --- | --- | --- |
| `children` | `ReactNode` | 必填 | 弹窗内容，可以是多个按钮、分组或其他业务组合；不是触发元素。 |
| `label` | `string` | `"本机修改"` | 同时用于触发按钮的可访问名称、title、可见文字和弹窗标题。 |

组件自带工具按钮。窄屏收起按钮的可见文字，仍保留可访问名称。内容在弹窗内按网格排列，业务可传入 `section` 等结构组织多个操作。

打开后由共享 Dialog 提供焦点约束、主题继承和关闭行为；Escape、关闭按钮和外部点击可关闭，关闭后由 Dialog 恢复入口焦点。保存、重试或导出完成本身不会自动关闭弹窗。业务若根据状态移除整个 `DraftActions`，后续焦点位置由所属页面安排。

## 保留业务状态与操作边界

草稿内容、持久化、操作 ID、并发版本、回执、错误和重试意图都由业务拥有者保存。需要跨弹窗开关保留的状态应放在该拥有者中。`DraftActions` 不执行保存、不捕获子操作错误，也没有 pending 属性或忙碌关闭锁；关闭工具弹窗不等于取消正在进行的请求。按钮是否禁用、错误如何展示、请求和组件卸载如何衔接，由所属业务处理。

放弃修改等需要确认的操作可作为内容组合 [ConfirmAction](./ConfirmAction.README.md)。确认回调负责实际放弃；取消确认保留业务状态。该内层确认框的在途关闭限制由 `ConfirmAction` 提供，不是外层 `DraftActions` 的保存或锁定策略。

## 查看实现与验证

- [组件实现](./DraftActions.tsx)和[共享 Dialog](./Dialog.tsx)定义入口、内容与浮层组合。
- [行为测试](./DraftActions.test.tsx)覆盖主动打开前不展示工具、Escape 关闭并恢复焦点，以及内层确认的取消、执行、pending 和失败行为。
- [表格工作区](../../features/sheets/SheetWorkspace.tsx)根据待处理状态提供重试、导出与放弃；[笔记本页面](../../features/documents/NotebookPage.tsx)提供“导入操作”的重试入口；[协作文档编辑器](../../features/documents/editor/CollaborativeDocumentEditorPage.tsx)提供恢复副本和重试保存。
- 通用主题、焦点和关闭约定见 [UI 包浮层契约](../../../packages/ui/docs/overlays.md)。

从 `frontend/` 执行现有用例：`npm run test:run -- src/shared/ui/DraftActions.test.tsx`。
