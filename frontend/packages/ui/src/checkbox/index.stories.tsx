import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Checkbox } from "./index";
const meta = { title: "Primitives/Checkbox", component: Checkbox } satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Keyboard: Story = { render: () => <div className="grid gap-3"><Checkbox>显示内容</Checkbox><Checkbox disabled defaultChecked>不可用</Checkbox></div>, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const checkbox = canvas.getByRole("checkbox", { name: "显示内容" });
  checkbox.focus();
  await userEvent.keyboard(" ");
  await expect(checkbox).toBeChecked();
  await userEvent.keyboard("{Enter}");
  await expect(checkbox).toBeChecked();
  await userEvent.click(canvas.getByText("显示内容"));
  await expect(checkbox).not.toBeChecked();
  await expect(canvas.getByRole("checkbox", { name: "不可用" })).toBeDisabled();
} };
