# Toolbar

`Toolbar` 和 `ToolbarButton/Group/Input/Link/Separator` 使用 Base UI 的显式工具栏组合。普通 shadcn Button 不会自动注册；用 `ToolbarButton render={<Button />}` 参与键盘遍历。Select 由业务持有 Root 与值，再将原生 SelectTrigger 组合为 ToolbarButton。

```tsx
import { Toolbar, ToolbarButton } from "@orbis/ui/toolbar";
import { Button } from "@orbis/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@orbis/ui/select";

<Toolbar aria-label="格式">
  <ToolbarButton render={<Button />}>撤销</ToolbarButton>
  <Select items={[{ value: "text", label: "正文" }]} defaultValue="text">
    <ToolbarButton render={<SelectTrigger aria-label="段落" />}><SelectValue /></ToolbarButton>
    <SelectContent><SelectItem value="text">正文</SelectItem></SelectContent>
  </Select>
  <ToolbarButton render={<Button />}>重做</ToolbarButton>
</Toolbar>
```

方向键与循环行为采用原生属性。ToolbarButton 默认让 disabled 项保持可聚焦以便发现，使用 aria-disabled 阻止激活；需要跳过的具体控件显式设置 `focusableWhenDisabled={false}`。根 disabled 不应通过普通 HTML disabled 属性断言代替实际的 click/keyboard 不激活验证。

浮层内的普通 Button 没有注册为 ToolbarButton，因此不会参加背后工具栏。需要浮层自身工具栏时显式提供新的 Toolbar Root。组件不扫描或克隆业务 DOM，不增加旧的隐式 scope；编辑器选择、保存与画布状态继续由业务持有。
