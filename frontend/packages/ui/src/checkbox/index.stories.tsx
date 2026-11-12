import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Checkbox } from "./index";
const meta = { title: "Primitives/Checkbox", component: Checkbox } satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Keyboard: Story = { render: () => <div className="grid gap-3"><div className="flex items-center gap-2"><Checkbox id="show-content" /><label htmlFor="show-content">显示内容</label></div><div className="flex items-center gap-2"><Checkbox id="disabled-content" disabled defaultChecked /><label htmlFor="disabled-content">不可用</label></div></div>, play: async ({ canvasElement }) => { const control = within(canvasElement).getByRole("checkbox", { name: "显示内容" }); control.focus(); await userEvent.keyboard(" "); await expect(control).toBeChecked(); await userEvent.keyboard(" "); await expect(control).not.toBeChecked(); await expect(within(canvasElement).getByRole("checkbox", { name: "不可用" })).toHaveAttribute("aria-disabled", "true"); } };
