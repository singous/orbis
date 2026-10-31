# DropdownMenu

`DropdownMenu` 用 `open/onOpenChange` 或 `defaultOpen` 管理一次菜单会话。`DropdownMenuTrigger asChild` 与 Button/原生按钮组合；不渲染重复按钮。

`DropdownMenuContent` 自己是 menu，需提供 aria-label，位置使用 side/align/sideOffset。Portal 仍挂 body，但使用打开位置的有效主题和局部 `--ob-*` token。className/style 属于 Popup；finalFocus 可以在菜单动作打开另一个弹窗时设为 false，避免关闭菜单夺回焦点。

`DropdownMenuItem` 用 onSelect 执行动作，disabled 阻止选择。默认选择后关闭；closeOnSelect=false 可以保留菜单。导航用 `asChild` 包住 Link/a，保留 href 和路由行为。不要把所有动作映射成字符串 key，也不支持 HeroUI 的 onAction/render API。

Label 必须属于 Group，由原语关联 group 名称。RadioGroup/RadioItem 保留泛型值；CheckboxItem 保留 checked/onCheckedChange。两种选中项默认选择后保持菜单打开，需要立即关闭时显式写 closeOnSelect。

键盘导航、禁用、链接、选择和关闭恢复在 Story 中验证；用户菜单在应用浏览器测试中覆盖主栏/侧栏及窄屏位置。
