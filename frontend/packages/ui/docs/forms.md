# 表单与值所有权

Input/Textarea 接收原生表单属性与 `onChange`，草稿由消费者拥有。使用显式 label 或包裹 label；错误时保留 `aria-invalid` 与 `aria-describedby`。后台刷新、提交失败和取消行为由业务模块处理，UI 包不自动重置值。

Select 使用复合 API：Root 管理值、开关、`items` 和回调；SelectTrigger 管理 `id`、ARIA、触发器尺寸与焦点；SelectValue 管理 `placeholder`；SelectContent 中显式渲染 SelectItem。表单拥有者通过 `label htmlFor` 关联 Trigger，描述或错误节点的 id 通过 `aria-describedby` 关联，不使用旧 `label/options/description/density/wrapperClassName` 根属性。

分组单选在 SelectContent 中组合 SelectGroup、SelectLabel、SelectItem 和组间的 SelectSeparator。可为 SelectContent 设置 `aria-label` 来命名展开后的列表。

业务选择器统一使用 `@orbis/ui/combobox` 的 Combobox。选项数据使用 `{ value, label }` 或 `{ label, items }` 分组。设置 `multiple` 可多选，默认展示可移除和清空的标签，`selectionDisplay="text"` 展示选中文本。通过 `value` 和 `onValueChange` 控制选中项。 `size` 同步调整触发区、搜索框、选项与标签的大小。使用方可通过 `className` 调整触发区宽度，通过 `popupProps.className` 调整弹层宽度。

- 省略 `search` 时，展开后直接浏览选项。
- `search={{ mode: "local", query, onQueryChange }}` 在控件内输入，组件过滤已提供的选项。可用 `placement: "popup"` 将输入框放到弹层顶部。
- `search={{ mode: "remote", query, onQueryChange, results, loading, error }}` 在弹层顶部输入。调用方根据查询发请求，并提供结果和加载、错误状态。结果按调用方返回的数据展示。`items` 可以保留已经选中的记录，`results` 提供本次展示的匹配项，两者保持同一种分组结构。

搜索框位于弹层时，展开后焦点留在触发按钮。点击搜索框或按 Tab 进入输入。

编辑器等已有浮层宿主需要自行协调键盘提交时，可用 ComboboxRoot 和其他组合部件。

选项标签需要在首次打开前显示时，将值和标签同时传给 Root 的 `items`。`null` 表示未选择，空字符串和数字 0 仍是有效值。受控和非受控行为、事件详情沿用 Base UI 标准 API；消费者按自己的业务类型处理回调，不用真值过滤丢掉有效的空字符串、0 或 false。

Button 使用 `onClick`、`disabled` 和标准 `render` 组合。表单提交显式写 `type="submit"`。处理中阻止重复提交时由业务设置 `disabled`；确需保留处理中操作的焦点与 Tab 顺序时同时设置 `focusableWhenDisabled`。忙碌语义用 `aria-busy`，视觉提示用显式 Spinner 与文案；没有 `loading` 或 `isPending` 兼容属性。Spinner 与已有按钮文案重复时设置 `aria-hidden`。

请求中的关闭规则由表单拥有者传给原语：可用 `disablePointerDismissal` 禁止背景关闭，并在 `onOpenChange` 收到关闭意图时调用 `details.cancel()` 阻止本次关闭。显式关闭控件也应呈现相应不可用状态。失败时保留草稿、错误原因和重试入口，瞬时 Toast 不替代实际恢复路径。
