import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { Button } from "@orbis/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@orbis/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@orbis/ui/dialog";
import { Toolbar, ToolbarButton } from "./index";

const paragraphItems = [{ value: "text", label: "正文" }, { value: "heading", label: "标题" }];
function ParagraphSelect() { return <Select defaultValue="text" items={paragraphItems}><ToolbarButton render={<SelectTrigger aria-label="段落" />}><SelectValue /></ToolbarButton><SelectContent>{paragraphItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>; }
const meta = { title: "Primitives/Toolbar", component: Toolbar } satisfies Meta<typeof Toolbar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Navigation: Story = {
  render: () => <><Button>工具栏之前</Button><Toolbar aria-label="格式"><ToolbarButton render={<Button />}>撤销</ToolbarButton><ToolbarButton disabled render={<Button />}>不可用</ToolbarButton><ParagraphSelect /><ToolbarButton render={<Button />}>重做</ToolbarButton></Toolbar><Button>工具栏之后</Button></>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body);
    const undo = canvas.getByRole("button", { name: "撤销" }), redo = canvas.getByRole("button", { name: "重做" }), select = canvas.getByRole("combobox", { name: "段落" });
    undo.focus(); await userEvent.keyboard("{ArrowRight}"); await expect(canvas.getByRole("button", { name: "不可用" })).toHaveFocus(); await userEvent.keyboard("{ArrowRight}"); await expect(select).toHaveFocus(); await userEvent.keyboard("{ArrowRight}"); await expect(redo).toHaveFocus(); await userEvent.keyboard("{ArrowRight}"); await expect(undo).toHaveFocus(); await userEvent.keyboard("{ArrowLeft}"); await expect(redo).toHaveFocus();
    await userEvent.click(select); const popup = await screen.findByRole("listbox"); await userEvent.click(await screen.findByRole("option", { name: "标题" })); await expect(select).toHaveTextContent("标题"); await waitFor(() => expect(select).toHaveAttribute("aria-expanded", "false")); await waitFor(() => expect(popup).not.toBeVisible()); await waitFor(() => expect(select).toHaveFocus());
    await userEvent.tab(); await expect(canvas.getByRole("button", { name: "工具栏之后" })).toHaveFocus(); await userEvent.tab({ shift: true }); await expect(select).toHaveFocus();
  },
};
export const Vertical: Story = { render: () => <Toolbar orientation="vertical" loopFocus={false} aria-label="画板工具"><ToolbarButton render={<Button />}>选择</ToolbarButton><ToolbarButton render={<Button />}>移动</ToolbarButton></Toolbar>, play: async ({ canvasElement }) => { const canvas = within(canvasElement), first = canvas.getByRole("button", { name: "选择" }), second = canvas.getByRole("button", { name: "移动" }); first.focus(); await userEvent.keyboard("{ArrowDown}"); await expect(second).toHaveFocus(); await userEvent.keyboard("{ArrowDown}"); await expect(second).toHaveFocus(); await userEvent.keyboard("{ArrowUp}"); await expect(first).toHaveFocus(); } };
const disabledAction = fn();
export const Disabled: Story = { render: () => <Toolbar disabled aria-label="只读工具栏"><ToolbarButton onClick={disabledAction} render={<Button />}>撤销</ToolbarButton><ParagraphSelect /></Toolbar>, play: async ({ canvasElement }) => {
  disabledAction.mockClear();
  const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body), undo = canvas.getByRole("button", { name: "撤销" }), select = canvas.getByRole("combobox", { name: "段落" });
  await expect(undo).toHaveAttribute("aria-disabled", "true"); await expect(select).toHaveAttribute("aria-disabled", "true");
  await userEvent.click(undo); undo.focus(); await userEvent.keyboard("{Enter} "); await expect(disabledAction).not.toHaveBeenCalled();
  select.focus(); await userEvent.keyboard("{ArrowDown}"); await expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
} };
export const PortalIsolation: Story = { render: () => <Toolbar aria-label="编辑工具"><Dialog><DialogTrigger render={<ToolbarButton render={<Button />} />}>打开设置</DialogTrigger><DialogContent><DialogHeader><DialogTitle>设置</DialogTitle></DialogHeader><Button>保存</Button><Button>取消</Button></DialogContent></Dialog><ToolbarButton render={<Button />}>插入</ToolbarButton></Toolbar>, play: async ({ canvasElement }) => { const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body), trigger = canvas.getByRole("button", { name: "打开设置" }); await userEvent.click(trigger); const dialog = await screen.findByRole("dialog", { name: "设置" }); const save = within(dialog).getByRole("button", { name: "保存" }); save.focus(); await userEvent.keyboard("{ArrowRight}"); await expect(save).toHaveFocus(); await userEvent.keyboard("{Escape}"); await waitFor(() => expect(dialog).not.toBeInTheDocument()); await waitFor(() => expect(trigger).toHaveFocus()); await userEvent.keyboard("{ArrowRight}"); await expect(canvas.getByRole("button", { name: "插入" })).toHaveFocus(); } };
