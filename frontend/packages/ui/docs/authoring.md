# 公共 API

组件属于 `src/<component>/index.tsx`，在文件底部显式导出组件和同名 Props，并登记 `package.json#exports`。不设置 root barrel、不暴露 Base UI 类型、render/context 或内部工具。应用只通过 `@orbis/ui/<component>` 使用。

包内不引入路由、业务 schema、查询、应用状态或应用目录。带产品文案、业务状态和保存策略的组合留在 `src/shared/ui` 或相应 feature。

先由真实消费者证明需求，再补组件。当前 Select 支持单选字符串或数字，`null` 表示无选择，空字符串和 0 是有效选项；没有多选消费者，暂不扩展多选 API。Dialog 使用受控/非受控判别联合。Ref 使用 React 19 的 ref prop。交互原语保留 `className(state)` / `style(state)`，状态使用自有类型，默认类先合并，调用方类后合并。Textarea 使用 disabled/readOnly/aria-invalid 推导样式状态，不另存镜像状态。

Button 的 `asChild` 只用于单个能接收原生按钮属性和 ref 的元素；导航链接使用 Link/a 与 `buttonVariants`，保留链接语义。业务不使用第三方 render API。

新增组件附适用的 Story、交互验证和类型用例。升级 shadcn 时先下载候选文件，与 `ui.registry.json` 中的来源核对后人工合并，禁止覆盖本地契约。
