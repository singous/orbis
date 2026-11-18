import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { Button } from "@orbis/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./index";
function Example() { return <TooltipProvider><Tooltip><TooltipTrigger render={<a href="#guide" />}>使用指南</TooltipTrigger><TooltipContent>打开使用指南</TooltipContent></Tooltip></TooltipProvider>; }
const meta = { title: "Primitives/Tooltip", component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LinkSemantics: Story = { play: async ({ canvasElement }) => { const link = within(canvasElement).getByRole("link", { name: "使用指南" }); await userEvent.hover(link); const tooltip = await within(canvasElement.ownerDocument.body).findByRole("tooltip"); await expect(tooltip).toHaveTextContent("打开使用指南"); await expect(tooltip.id).not.toBe(""); await expect(link).toHaveAttribute("aria-describedby", tooltip.id); await expect(link).toHaveAttribute("href", "#guide"); await expect(link).not.toHaveAttribute("role", "button"); await userEvent.keyboard("{Escape}"); await waitFor(() => expect(within(canvasElement.ownerDocument.body).queryByRole("tooltip")).not.toBeInTheDocument()); } };

export const DistinctDescriptions: Story = { render: () => <TooltipProvider><div className="flex gap-3"><Tooltip><TooltipTrigger render={<Button />}>第一个操作</TooltipTrigger><TooltipContent>第一个说明</TooltipContent></Tooltip><Tooltip><TooltipTrigger render={<Button />}>第二个操作</TooltipTrigger><TooltipContent>第二个说明</TooltipContent></Tooltip></div></TooltipProvider>, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body);
  const first = canvas.getByRole("button", { name: "第一个操作" }), second = canvas.getByRole("button", { name: "第二个操作" });
  first.focus(); const firstTip = await screen.findByRole("tooltip"); await expect(firstTip).toHaveTextContent("第一个说明"); await expect(first).toHaveAttribute("aria-describedby", firstTip.id);
  const firstId = firstTip.id; await userEvent.keyboard("{Escape}"); await waitFor(() => expect(firstTip).not.toBeInTheDocument());
  await userEvent.tab(); await expect(second).toHaveFocus(); const secondTip = await screen.findByRole("tooltip"); await expect(secondTip).toHaveTextContent("第二个说明"); await expect(second).toHaveAttribute("aria-describedby", secondTip.id); await expect(secondTip.id).not.toBe(firstId);
  await userEvent.keyboard("{Escape}"); await waitFor(() => expect(secondTip).not.toBeInTheDocument());
} };
