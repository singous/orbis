import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within, waitFor } from "storybook/test";
import { useState } from "react";
import { Button } from "@orbis/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuCheckboxItem } from "./index";

function Example({ onSelect }: { onSelect: () => void }) {
  const [layout, setLayout] = useState("list");
  const [pinned, setPinned] = useState(false);
  return <div data-theme="dark"><DropdownMenu><DropdownMenuTrigger asChild><Button>页面操作</Button></DropdownMenuTrigger><DropdownMenuContent aria-label="页面操作菜单">
    <DropdownMenuItem onSelect={onSelect}>保存</DropdownMenuItem>
    <DropdownMenuItem disabled onSelect={onSelect}>不可用</DropdownMenuItem>
    <DropdownMenuItem asChild><a href="#target">打开链接</a></DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuGroup><DropdownMenuLabel>显示</DropdownMenuLabel><DropdownMenuRadioGroup value={layout} onValueChange={setLayout}><DropdownMenuRadioItem value="list">列表</DropdownMenuRadioItem><DropdownMenuRadioItem value="grid">网格</DropdownMenuRadioItem></DropdownMenuRadioGroup><DropdownMenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>固定</DropdownMenuCheckboxItem></DropdownMenuGroup>
    <DropdownMenuItem variant="danger">移除</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu></div>;
}
const meta = { title: "Primitives/DropdownMenu", component: Example, args: { onSelect: fn() } } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const KeyboardAndSelection: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const screen = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: "页面操作" });
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    const menu = await screen.findByRole("menu", { name: "页面操作菜单" });
    await expect(menu.closest("[data-theme]")).toHaveAttribute("data-theme", "dark");
    await expect(within(menu).getByRole("menuitem", { name: "打开链接" })).toHaveAttribute("href", "#target");
    await expect(within(menu).getByRole("menuitem", { name: "不可用" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(within(menu).getByRole("menuitemradio", { name: "网格" }));
    await expect(within(menu).getByRole("menuitemradio", { name: "网格" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "固定" }));
    await expect(within(menu).getByRole("menuitemcheckbox", { name: "固定" })).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("menuitem", { name: "保存" }));
    await expect(args.onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  },
};
export const OpenStates: Story = {
  render: () => <DropdownMenu defaultOpen><DropdownMenuTrigger asChild><Button>菜单状态</Button></DropdownMenuTrigger><DropdownMenuContent aria-label="菜单状态"><DropdownMenuItem>普通动作</DropdownMenuItem><DropdownMenuItem variant="danger">移除</DropdownMenuItem><DropdownMenuItem disabled>不可用</DropdownMenuItem><DropdownMenuGroup><DropdownMenuLabel>布局</DropdownMenuLabel><DropdownMenuRadioGroup defaultValue="list"><DropdownMenuRadioItem value="list">列表</DropdownMenuRadioItem><DropdownMenuRadioItem value="grid">网格</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>,
};
export const DarkOpen: Story = { ...OpenStates, globals: { theme: "dark" } };
