import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within, waitFor } from "storybook/test";
import { useState } from "react";
import { Button } from "@orbis/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuCheckboxItem } from "./index";
function Example({ onAction }: { onAction?: () => void }) { const [layout, setLayout] = useState("list"), [pinned, setPinned] = useState(false); return <DropdownMenu><DropdownMenuTrigger render={<Button />}>视图操作</DropdownMenuTrigger><DropdownMenuContent aria-label="视图操作"><DropdownMenuItem onClick={onAction}>打开视图</DropdownMenuItem><DropdownMenuItem disabled>不可用</DropdownMenuItem><DropdownMenuGroup><DropdownMenuLabel>布局</DropdownMenuLabel><DropdownMenuRadioGroup value={layout} onValueChange={setLayout}><DropdownMenuRadioItem value="list" closeOnClick={false}>列表</DropdownMenuRadioItem><DropdownMenuRadioItem value="grid" closeOnClick={false}>网格</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuGroup><DropdownMenuCheckboxItem checked={pinned} onCheckedChange={setPinned} closeOnClick={false}>固定</DropdownMenuCheckboxItem></DropdownMenuContent></DropdownMenu>; }
const meta = { title: "Primitives/DropdownMenu", component: Example, args: { onAction: fn() } } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const KeyboardAndSelection: Story = { play: async ({ canvasElement, args }) => {
  const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body); const trigger = canvas.getByRole("button", { name: "视图操作" }); trigger.focus(); await userEvent.keyboard("{ArrowDown}");
  const menu = await screen.findByRole("menu", { name: "视图操作" }); await expect(within(menu).getByRole("menuitem", { name: "打开视图" })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}"); await expect(within(menu).getByRole("menuitem", { name: "不可用" })).toHaveAttribute("aria-disabled", "true");
  await userEvent.keyboard("{ArrowDown}{ArrowDown}"); const grid = within(menu).getByRole("menuitemradio", { name: "网格" }); await expect(grid).toHaveFocus(); await userEvent.keyboard(" "); await expect(grid).toHaveAttribute("aria-checked", "true");
  await userEvent.keyboard("{ArrowDown} "); await expect(within(menu).getByRole("menuitemcheckbox", { name: "固定" })).toHaveAttribute("aria-checked", "true");
  await userEvent.keyboard("{Escape}"); await waitFor(() => expect(trigger).toHaveFocus());
  await userEvent.click(trigger); const reopened = await screen.findByRole("menu", { name: "视图操作" }); await userEvent.click(within(reopened).getByRole("menuitem", { name: "打开视图" })); await expect(args.onAction).toHaveBeenCalledTimes(1); await waitFor(() => expect(reopened).not.toBeInTheDocument()); await waitFor(() => expect(trigger).toHaveFocus());
} };
export const OpenStates: Story = { render: () => <DropdownMenu defaultOpen><DropdownMenuTrigger render={<Button />}>菜单状态</DropdownMenuTrigger><DropdownMenuContent aria-label="菜单状态"><DropdownMenuItem>普通动作</DropdownMenuItem><DropdownMenuItem variant="destructive">移除</DropdownMenuItem><DropdownMenuItem disabled>不可用</DropdownMenuItem><DropdownMenuGroup><DropdownMenuLabel>布局</DropdownMenuLabel><DropdownMenuRadioGroup defaultValue="list"><DropdownMenuRadioItem value="list">列表</DropdownMenuRadioItem><DropdownMenuRadioItem value="grid">网格</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuGroup></DropdownMenuContent></DropdownMenu> };
export const DarkOpen: Story = { ...OpenStates, globals: { theme: "dark" } };
