# ColorField

ColorField 保留业务 value/onChange/onChangeEnd，不在包内持久化颜色。站点表单用 onChange 更新表单，BoardInspector 用 onChange 保留草稿、onChangeEnd 提交命令并沿用自己的去重/版本逻辑。

Popover 打开时包含完整饱和度/亮度区域、色相滑块和“十六进制颜色”文本框。输入框打字只修改局部草稿；blur/非 IME Enter 才提交有效颜色，并先 onChange 再 onChangeEnd。有效短写展开为六位大写，错误或空文本回到当前颜色，不产生值修改。方向键沿用旧颜色字段的 RGB 整数递增/递减，结束仍由 blur 负责。关闭浮层前会完成聚焦输入框的 blur 提交，避免卸载丢失正常编辑结果。

来自已有值的 RGB、HSL、HSB 和 HEX/HEXA 可以显示为六位十六进制编辑值。值的透明部分和原始格式在没有用户编辑时保留；编辑后沿用旧组件 `toString("hex")` 的六位输出，不引入 alpha 滑块。画板的透明填充/背景仍由原调用方提供白色编辑值，不修改其透明存储语义。

聚焦输入时后台 prop 更新不覆盖局部文本；失焦后跟随当前值。disabled 约束触发器、颜色原语和输入框。原语细节、第三方固定版本和控制结束事件见 `@orbis/ui/color-picker` 的 README。

十六进制编辑保留旧字段的入口约束：只接收可选 # 加最多六个十六进制字符。非法字符和超长粘贴整体拒绝，不能通过 maxlength 截成另一种可提交颜色；合法但不完整的草稿仍在 blur/Enter 时恢复。源值支持的 HEXA 只在未编辑时保留，不把它扩展成新的透明度编辑功能。
