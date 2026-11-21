import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within, waitFor } from "storybook/test";
import { useState } from "react";
import { Button } from "@orbis/ui/button";
import { FilePlus2, Trash2 } from "@orbis/ui/icons";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuCheckboxItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "./index";
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

export const RichItems: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button />}>文件操作</DropdownMenuTrigger>
      <DropdownMenuContent aria-label="文件操作" className="w-64">
        <DropdownMenuItem label="新建文件" icon={<FilePlus2 />} description="创建新文件" shortcut="⌘ N">新建文件</DropdownMenuItem>
        <DropdownMenuItem label="删除文件" icon={<Trash2 />} description="移至回收篓" shortcut="⌘ ⇧ D" level="danger">删除文件</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "文件操作" });
    const screen = within(canvasElement.ownerDocument.body);
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    const menu = await screen.findByRole("menu", { name: "文件操作" });
    const create = within(menu).getByRole("menuitem", { name: /^新建文件$/ });
    await expect(create).toHaveAccessibleDescription("创建新文件");
    await userEvent.keyboard("{ArrowDown}");
    const remove = within(menu).getByRole("menuitem", { name: /^删除文件$/ });
    await expect(remove).toHaveAttribute("data-level", "danger");
    await expect(remove).toHaveAccessibleDescription("移至回收篓");
    const view = remove.ownerDocument.defaultView!;
    const probe = remove.ownerDocument.createElement("span");
    probe.style.color = "var(--destructive)";
    remove.append(probe);
    await expect(view.getComputedStyle(remove).color).toBe(view.getComputedStyle(probe).color);
    probe.remove();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const NestedMenus: Story = {
  args: { onAction: fn() },
  render: ({ onAction }) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button />}>分享</DropdownMenuTrigger>
      <DropdownMenuContent aria-label="分享">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>其他方式</DropdownMenuSubTrigger>
          <DropdownMenuSubContent aria-label="其他方式">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>邮件</DropdownMenuSubTrigger>
              <DropdownMenuSubContent aria-label="邮件">
                <DropdownMenuItem onClick={onAction}>工作邮箱</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvasElement, args }) => {
    const trigger = within(canvasElement).getByRole("button", { name: "分享" });
    const screen = within(canvasElement.ownerDocument.body);
    trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    const sharing = await screen.findByRole("menu", { name: "分享" });
    await waitFor(() => expect(within(sharing).getByRole("menuitem", { name: "其他方式" })).toHaveFocus());
    await userEvent.keyboard("{ArrowRight}");
    const other = await screen.findByRole("menu", { name: "其他方式" });
    await waitFor(() => expect(within(other).getByRole("menuitem", { name: "邮件" })).toHaveFocus());
    await userEvent.keyboard("{ArrowRight}");
    const mail = await screen.findByRole("menu", { name: "邮件" });
    await waitFor(() => expect(within(mail).getByRole("menuitem", { name: "工作邮箱" })).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await expect(args.onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
