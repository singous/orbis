# ColorPicker

该原语是固定 `react-colorful` 5.8.1 的适配入口，MIT，使用完整二维饱和度/亮度区域及色相滑块；不是原生单按钮颜色输入。

value 接收规范的六位十六进制颜色。onValueChange 在区域拖动或方向键调整时持续返回颜色，onValueChangeEnd 在鼠标/触摸结束或方向键 keyup 时返回最后一次实际变更；输出保持现有 ColorField 的大写 `#RRGGBB` 格式。没有变化的手势不产生结束写入。输入 CSS 格式和十六进制编辑草稿由应用 ColorField pattern 拥有。

此版本不提供内层标签或 disabled API。适配器根据固定 DOM 将两个滑块命名为“饱和度与亮度”“色相”，为二维区域保留数值范围和中文 valuetext；disabled 时使用 inert、ARIA 和 Tab 顺序约束，回调也不会输出变更。包升级需重跑这些标签、键盘、指针和 disabled Story。

组件 CSS 仅作用于 `.ob-color-picker` 内部，覆盖第三方未分层样式的尺寸与焦点。区域高度 160px，与既有 ColorField 匹配；颜色梯度和指针颜色仍由组件值决定，不使用 UI 主题色替代内容颜色。
