import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { useRef } from "react";
import { Button } from "@orbis/ui/button";
import { Input } from "@orbis/ui/input";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose, SheetFooter } from "./index";
function Example() { const field = useRef<HTMLInputElement>(null); return <Sheet><SheetTrigger render={<Button />}>查看评论</SheetTrigger><SheetContent initialFocus={field}><SheetHeader><SheetTitle>评论</SheetTitle><SheetDescription>查看和恢复已保存的正文。</SheetDescription></SheetHeader><label className="grid gap-2 px-4">评论内容<Input ref={field} defaultValue="我的评论" /></label><SheetFooter><SheetClose render={<Button variant="outline" />}>关闭评论</SheetClose></SheetFooter></SheetContent></Sheet>; }
const meta = { title: "Primitives/Sheet", component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Focus: Story = { play: async ({ canvasElement }) => { const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body), trigger = canvas.getByRole("button", { name: "查看评论" }); await userEvent.click(trigger); const dialog = await screen.findByRole("dialog", { name: "评论" }); await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "评论内容" })).toHaveFocus()); await userEvent.keyboard("{Escape}"); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); await waitFor(() => expect(trigger).toHaveFocus()); } };
export const CallerStyles: Story = { render: () => <Sheet defaultOpen><SheetContent className="w-80"><SheetHeader><SheetTitle>调用方布局</SheetTitle></SheetHeader><SheetClose render={<Button variant="outline" />}>关闭</SheetClose></SheetContent></Sheet>, play: async ({ canvasElement }) => { const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "调用方布局" }); await expect(dialog).toHaveClass("w-80"); } };
