import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { Button } from "@orbis/ui/button";
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetClose } from "./index";
function Example() { return <Sheet><SheetTrigger asChild><Button>查看评论</Button></SheetTrigger><SheetContent className="p-6"><SheetTitle>评论</SheetTitle><p>查看和恢复已保存的正文。</p><SheetClose asChild><Button>关闭评论</Button></SheetClose></SheetContent></Sheet>; }
const meta = { title: "Primitives/Sheet", component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Focus: Story = { play: async ({ canvasElement }) => { const canvas = within(canvasElement); const trigger = canvas.getByRole("button", { name: "查看评论" }); await userEvent.click(trigger); const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "评论" }); await waitFor(() => expect(dialog).toBeVisible()); await userEvent.keyboard("{Escape}"); await waitFor(() => expect(trigger).toHaveFocus()); } };

export const StateClassName: Story = { render: () => <Sheet defaultOpen><SheetContent className={state => state.open ? "w-80 p-6" : undefined}><SheetTitle>状态样式</SheetTitle><SheetClose asChild><Button>关闭</Button></SheetClose></SheetContent></Sheet>, play: async ({ canvasElement }) => {
  const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "状态样式" });
  await waitFor(() => expect(dialog.getBoundingClientRect().width).toBe(320));
} };
