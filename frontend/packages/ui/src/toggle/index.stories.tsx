import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Toggle } from "./index";
const meta = { title: "Primitives/Toggle", component: Toggle } satisfies Meta<typeof Toggle>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Keyboard: Story = { render: () => <Toggle>粗体</Toggle>, play: async ({ canvasElement }) => { const control = within(canvasElement).getByRole("button", { name: "粗体" }); control.focus(); await userEvent.keyboard(" "); await expect(control).toHaveAttribute("aria-pressed", "true"); } };
