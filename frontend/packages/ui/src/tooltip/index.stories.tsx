import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { Tooltip, TooltipTrigger, TooltipContent } from "./index";

function Example() { return <Tooltip delayMs={0}><TooltipTrigger asChild><a href="#guide">使用指南</a></TooltipTrigger><TooltipContent>打开使用指南</TooltipContent></Tooltip>; }
const meta = { title: "Primitives/Tooltip", component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LinkSemantics: Story = {
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link", { name: "使用指南" });
    await userEvent.hover(link);
    const tooltip = await within(canvasElement.ownerDocument.body).findByRole("tooltip");
    await expect(tooltip).toHaveTextContent("打开使用指南");
    await expect(link).toHaveAttribute("href", "#guide");
    await expect(link).not.toHaveAttribute("role", "button");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).queryByRole("tooltip")).not.toBeInTheDocument());
  },
};
