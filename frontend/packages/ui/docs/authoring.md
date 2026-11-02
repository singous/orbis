# 公共 API

组件属于 `src/<component>/index.tsx`，在文件底部显式导出，并登记 `package.json#exports`。应用只通过 `@orbis/ui/<component>` 使用；没有 root barrel，不导入包的内部目录。包内不引入路由、业务 schema、查询、应用状态或应用目录。

通用组件采用 shadcn 的 `base-nova` 官方源码、默认样式与组合 API。Base UI 的 `render`、事件详情、受控与非受控属性以及原语类型均为正常公共能力。Props 直接来自实现的上游类型，消费者需要类型时使用 `ComponentProps<typeof Button>` 等派生方式；不再复制一套 owned Props、状态类型或旧组件接口。

Button 使用 `default`、`outline`、`secondary`、`ghost`、`destructive`、`link` 变体。组合元素使用 `render`；链接保留 Link/a 的语义。加载、业务文案和保存策略由消费者显式组合 `disabled`、`focusableWhenDisabled`、`aria-busy` 与 Spinner。旧 `loading`、`appearance`、`asChild`、`onPress` 和 `isPending` 接口已退出，不在新目录中复刻。

Select 使用 Select/SelectTrigger/SelectValue/SelectContent/SelectItem 组合，选项标签需要在首次打开前显示时给 Root 提供 `items`。可见标签、描述和错误消息由表单拥有者与触发器显式关联。Dialog 使用 DialogHeader/Title/Description/Footer 组合标题和正文，采用上游的关闭与焦点 API。产品文案、请求生命周期、空值转换和保存失败恢复留在 `src/shared/ui` 的业务组合或相应 feature。

Toolbar 的键盘成员通过显式的 ToolbarButton、ToolbarLink、ToolbarInput 等原语注册。普通 Button 不会自动变成 ToolbarButton；浮层正文也不会因位于工具栏的 React 子树而自动注册。需要按钮默认样式时用 `ToolbarButton render={<Button />}` 组合，Select 等复合控件同样显式组合其触发器。

独立阅读主题与外部宿主是应用的实际集成需求。通用浮层只通过 `OverlayScopeProvider` 接收显式主题范围，标准 Portal 属性仍可覆盖范围值；独立宿主使用 `@orbis/ui/portal`。详见[浮层契约](overlays.md)。这些能力不承担旧控件外观兼容。

新增组件先有真实消费者，再附适用的 Story、交互验证和类型用例。`check:ui` 检查组件子路径、包与应用依赖方向、原语和图标入口、CSS 所有权、主题角色，以及退役 shared UI 文件、导入和原生组件上的旧属性。业务的 `query.isPending`、ReadStatus `appearance` 等不受旧组件属性检查影响。

依赖和 copied code 按[准入、升级及移除流程](dependencies.md)维护。官方候选在隔离目录用已记录的 shadcn CLI 版本生成；`ui.registry.json` 与 `licenses/copied-code/*.registry.json` 保存来源、实际获取记录、冻结内容及校验值。升级时比较真实上游输出，保留必要的导入路径、图标、本地化、主题范围与可访问性适配，并同步记录；不把手写旧外观当作上游生成结果。
