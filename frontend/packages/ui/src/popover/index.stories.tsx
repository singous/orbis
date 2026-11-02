import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { useState } from "react";
import { Button } from "@orbis/ui/button";
import { Input } from "@orbis/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "./index";
function Example() { const [open, setOpen] = useState(false); return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger render={<Button />}>编辑名称</PopoverTrigger><PopoverContent aria-label="名称设置"><label className="grid gap-2">名称<Input defaultValue="我的空间" /></label><Button onClick={() => setOpen(false)}>完成</Button></PopoverContent></Popover>; }
const meta = { title: "Primitives/Popover", component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FocusAndDismissal: Story = { play: async ({ canvasElement }) => { const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body); const trigger = canvas.getByRole("button", { name: "编辑名称" }); await userEvent.click(trigger); const dialog = await screen.findByRole("dialog", { name: "名称设置" }); const input = within(dialog).getByRole("textbox", { name: "名称" }); await waitFor(() => expect(input).toHaveFocus()); await userEvent.type(input, "编辑"); await userEvent.keyboard("{Escape}"); await waitFor(() => expect(trigger).toHaveFocus()); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); } };
