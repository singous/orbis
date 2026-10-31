# 表单与值所有权

Input/Textarea 接收原生表单属性与 onChange，草稿由消费者拥有。使用显式 label 或包裹 label；错误时保留 aria-invalid 与 aria-describedby。后台刷新、提交失败和取消行为由业务模块处理，UI 包不自动重置值。

Select 的 label 自动关联触发器；无可见 label 时必须提供 aria-label。受控 value 与 defaultValue 互斥，回调类型保留选项值。空字符串和数字 0 是有效值，null 才表示没有选择。`wrapperClassName` 负责外层布局；`className`、`style`、原生 ARIA、焦点事件和 ref 属于触发器。`density` 的 compact/default/form 对应 32/36/40px，默认 form；description 自动并入 aria-describedby，保留调用方已有的描述。浮层 open/defaultOpen 与值的受控状态分别判别。

Button 默认 type=button，表单提交必须显式写 type=submit。disabled 表示不可用并退出 Tab 顺序；loading 表示动作处理中，阻止重复激活但保留焦点和 Tab 顺序。loading 不自动设置 aria-busy，长任务进度由业务提供独立状态区域。
