import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Input } from "./index";

const meta = { title: "Primitives/Input", component: Input } satisfies Meta<typeof Input>;
export default meta;
type Story = StoryObj<typeof meta>;
export const States: Story = {
  render: () => <div className="grid gap-4"><label>名称<Input placeholder="输入名称" /></label><label>只读<Input readOnly value="现有名称" /></label><label>不可用<Input disabled value="不可编辑" /></label><label>错误<Input aria-invalid="true" aria-describedby="input-error" /></label><p id="input-error">请输入名称</p></div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "名称" }), "我的名称");
    await expect(canvas.getByRole("textbox", { name: "名称" })).toHaveValue("我的名称");
    await expect(canvas.getByRole("textbox", { name: "错误" })).toHaveAccessibleDescription("请输入名称");
  },
};
