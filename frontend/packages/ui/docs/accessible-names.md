# 可访问名称

有可见文字时优先由文字形成名称。Button 为文字容器生成稳定 id，通过 aria-labelledby 关联，让加载文案变化可被辅助技术识别。显式 aria-labelledby/aria-label 仍可用于复杂组合和纯图标操作，但不要覆盖有意义的可见文案。

图标、装饰符与 spinner 使用 aria-hidden。Dialog 通过 Title/Description 关联名称和描述。Select 使用可见 label，列表选项由对应文本命名。

新交互在 Story 中验证 role、名称与键盘。axe 设置为 error，不能通过关闭对比度规则绕过 token 缺陷。当前危险色已经根据真实 Chromium 的对比度失败调整。
