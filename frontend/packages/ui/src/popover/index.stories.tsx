import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { Button } from "@orbis/ui/button";
import { Input } from "@orbis/ui/input";
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from "./index";

function Example() {
  return <Popover><PopoverTrigger asChild><Button>编辑名称</Button></PopoverTrigger><PopoverContent aria-label="名称设置" className="grid justify-items-start gap-3"><label className="grid gap-2">名称<Input defaultValue="我的空间" /></label><PopoverClose asChild><Button>完成</Button></PopoverClose></PopoverContent></Popover>;
}
const meta = { title: "Primitives/Popover", component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FocusAndDismissal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const screen = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: "编辑名称" });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "名称设置" });
    const input = within(dialog).getByRole("textbox", { name: "名称" });
    await waitFor(() => expect(input).toHaveFocus());
    const complete = within(dialog).getByRole("button", { name: "完成" });
    const focus = getComputedStyle(input);
    await expect(complete.getBoundingClientRect().top - input.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(parseFloat(focus.outlineWidth) + parseFloat(focus.outlineOffset));
    await userEvent.type(input, "编辑");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
};
