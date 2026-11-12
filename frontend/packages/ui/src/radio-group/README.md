# RadioGroup

采用 shadcn base-nova 的原生 `RadioGroup` 和 `RadioGroupItem`。Root 通过 `value/defaultValue/onValueChange` 管理选择，Item 的可见说明由显式 label 组合；没有自包标签或旧的值泛型适配层。

方向键、禁用项、单选状态和表单参与由 Base UI 负责。业务在回调入口将选中值转换为自己的领域联合类型，并保留有效的空字符串或数字 0。
