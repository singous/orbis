# Tooltip

Tooltip/Trigger/Content 为触发器提供说明。默认 hover 延迟 300ms，键盘焦点也能打开；Escape 关闭。Trigger asChild 保留链接或按钮的原有语义、事件与 ref，不增加第二个焦点环。

本包拥有稳定的内容 ID、role=tooltip 与 aria-describedby 关联，并合并消费者已有的描述 ID。内容 ID 不作为公共可改属性，避免外部改 ID 后打断关联。提示不是触发器名称的替代品：图标按钮仍须有 aria-label，可见文字仍由文字命名。

`src/shared/ui/Tooltip` 保留旧的 label/children 便捷 API，并组合本包原语。通用原语没有 Orbis 业务文案。
