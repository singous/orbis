import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Textarea } from "./index";
const meta = { title: "Primitives/Textarea", component: Textarea } satisfies Meta<typeof Textarea>;
export default meta;
type Story = StoryObj<typeof meta>;
export const States: Story = { render: () => <div className="grid gap-4"><label>个人简介<Textarea placeholder="介绍一下自己" /></label><label>只读简介<Textarea readOnly value="现有简介" /></label><label>不可用<Textarea disabled value="不可编辑" /></label></div> };

export const StateStyles: Story = {
  render: () => <label>只读内容<Textarea readOnly value="现有内容" className={state => state.readOnly ? "text-base" : "text-sm"} style={state => ({ resize: state.readOnly ? "none" : "vertical" })} /></label>,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("textbox", { name: "只读内容" })).toHaveStyle({ resize: "none", fontSize: "16px" });
  },
};
