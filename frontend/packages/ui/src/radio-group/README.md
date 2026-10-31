# RadioGroup

RadioGroup 保留泛型 value/onValueChange，受控与非受控值互斥。RadioGroupItem 的 children 是可见标签和可选装饰图标；原语管理隐藏原生 input、单选关系、Tab 和方向键。

整行是可聚焦 radio，并拥有可见焦点环；内部圆形指示器使用 aria-hidden。组由 aria-label 或 aria-labelledby 命名。disabled、readOnly、required 与 name/form 保留表单语义，状态样式使用 data attributes 或 className/style 回调。

外观弹窗用该组件更新现有 appearance store；UI 包不读取或持久化产品偏好。
