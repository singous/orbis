import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { useId, useRef, useState, type CSSProperties } from "react";
import { Button } from "@orbis/ui/button";
import { Input } from "@orbis/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@orbis/ui/select";
import { OverlayScopeProvider } from "../internal/overlay-scope";
import { Dialog, DialogTrigger, DialogContent, DialogFooter, DialogClose, DialogHeader, DialogTitle, DialogDescription } from "./index";

function NestedForm() {
  const [value, setValue] = useState<string | null>("");
  const label = useId();
  const items = [{ value: "", label: "不分组" }, { value: "name", label: "按名称" }];
  return <OverlayScopeProvider value={{ "data-theme": "light", className: "light" }}><Dialog>
    <DialogTrigger render={<Button />}>编辑设置</DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>显示设置</DialogTitle><DialogDescription>为当前视图选择分组方式。</DialogDescription></DialogHeader>
      <div className="grid gap-2"><label id={label}>分组方式</label><Select items={items} value={value} onValueChange={setValue}><SelectTrigger aria-labelledby={label}><SelectValue /></SelectTrigger><SelectContent>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
      <DialogFooter><DialogClose render={<Button variant="outline" />}>取消</DialogClose></DialogFooter>
    </DialogContent>
  </Dialog></OverlayScopeProvider>;
}
const meta = { title: "Primitives/Dialog", component: NestedForm } satisfies Meta<typeof NestedForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NestedSelect: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body);
  const trigger = canvas.getByRole("button", { name: "编辑设置" }); await userEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "显示设置" }); await expect(dialog.closest("[data-theme]")).toHaveAttribute("data-theme", "light");
  const select = within(dialog).getByRole("combobox", { name: "分组方式" }); await userEvent.click(select);
  const option = await screen.findByRole("option", { name: "按名称" }); await expect(option.closest("[data-theme]")).toHaveAttribute("data-theme", "light");
  await userEvent.keyboard("{Escape}"); await expect(dialog).toBeVisible(); await waitFor(() => expect(select).toHaveFocus());
  await userEvent.click(select); await userEvent.click(await screen.findByRole("option", { name: "按名称" })); await expect(select).toHaveTextContent("按名称");
  await userEvent.keyboard("{Escape}"); await waitFor(() => expect(trigger).toHaveFocus()); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
} };
export const ControlledInitialFocus: Story = {
  render: function ControlledForm() { const [open, setOpen] = useState(false); const input = useRef<HTMLInputElement>(null); return <><Button onClick={() => setOpen(true)}>打开受控表单</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent initialFocus={input}><DialogHeader><DialogTitle>受控表单</DialogTitle></DialogHeader><label>名称<Input ref={input} /></label></DialogContent></Dialog></>; },
  play: async ({ canvasElement }) => { const trigger = within(canvasElement).getByRole("button", { name: "打开受控表单" }); const screen = within(canvasElement.ownerDocument.body); for (const activation of ["pointer", "keyboard"]) { if (activation === "pointer") await userEvent.click(trigger); else await userEvent.keyboard("{Enter}"); const dialog = await screen.findByRole("dialog", { name: "受控表单" }); await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "名称" })).toHaveFocus()); await userEvent.keyboard("{Escape}"); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); await waitFor(() => expect(trigger).toHaveFocus()); } },
};
export const LocalTokens: Story = {
  render: function ScopedTokens() { const [primary, setPrimary] = useState("var(--destructive)"); const style = { "--primary": primary } as CSSProperties; return <div data-testid="theme-owner" data-theme="light" style={style}><OverlayScopeProvider value={{ "data-theme": "light", className: "light", style }}><Dialog><DialogTrigger render={<Button />}>打开局部主题</DialogTrigger><DialogContent><DialogHeader><DialogTitle>局部主题</DialogTitle></DialogHeader><Button onClick={() => setPrimary("var(--foreground)")}>切换主题色</Button></DialogContent></Dialog></OverlayScopeProvider></div>; },
  play: async ({ canvasElement }) => { const owner = within(canvasElement).getByTestId("theme-owner"), screen = within(canvasElement.ownerDocument.body); await userEvent.click(within(canvasElement).getByRole("button", { name: "打开局部主题" })); const dialog = await screen.findByRole("dialog", { name: "局部主题" }); const read = (element: Element) => getComputedStyle(element).getPropertyValue("--primary"); await waitFor(() => expect(read(dialog)).toBe(read(owner))); await userEvent.click(within(dialog).getByRole("button", { name: "切换主题色" })); await waitFor(() => expect(read(dialog)).toBe(read(owner))); await userEvent.keyboard("{Escape}"); },
};
export const ExplicitThemeScope: Story = { render: () => <OverlayScopeProvider value={{ "data-theme": "dark", className: "dark" }}><Dialog><DialogTrigger render={<Button />}>从独立主题打开</DialogTrigger><DialogContent><DialogHeader><DialogTitle>显式主题范围</DialogTitle><DialogDescription>浮层采用业务作用域提供的主题。</DialogDescription></DialogHeader></DialogContent></Dialog></OverlayScopeProvider>, play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: "从独立主题打开" })); const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "显式主题范围" }); await expect(dialog.closest("[data-theme]")).toHaveAttribute("data-theme", "dark"); await userEvent.keyboard("{Escape}"); } };
export const ComposedPopup: Story = {
  render: function ComposedExample() { const [completed, setCompleted] = useState<boolean | null>(null); return <><Dialog onOpenChangeComplete={setCompleted}><DialogTrigger render={<Button />}>打开组合浮层</DialogTrigger><DialogContent><DialogHeader><DialogTitle>组合浮层</DialogTitle><DialogDescription>内容采用原生组件组合。</DialogDescription></DialogHeader><DialogFooter><DialogClose render={<Button variant="outline" />}>关闭组合浮层</DialogClose></DialogFooter></DialogContent></Dialog><output aria-label="浮层状态">{completed === null ? "尚未打开" : completed ? "已打开" : "已关闭"}</output></>; },
  play: async ({ canvasElement }) => { const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body), trigger = canvas.getByRole("button", { name: "打开组合浮层" }); await userEvent.click(trigger); const dialog = await screen.findByRole("dialog", { name: "组合浮层" }); await waitFor(() => expect(canvas.getByLabelText("浮层状态")).toHaveTextContent("已打开")); await userEvent.click(within(dialog).getByRole("button", { name: "关闭组合浮层" })); await waitFor(() => expect(canvas.getByLabelText("浮层状态")).toHaveTextContent("已关闭")); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); await waitFor(() => expect(trigger).toHaveFocus()); },
};
export const OutsideDismissalPolicy: Story = { render: () => <Dialog disablePointerDismissal><DialogTrigger render={<Button />}>打开确认</DialogTrigger><DialogContent><DialogHeader><DialogTitle>确认操作</DialogTitle></DialogHeader><DialogClose render={<Button variant="outline" />}>取消操作</DialogClose></DialogContent></Dialog>, play: async ({ canvasElement }) => { const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body); await userEvent.click(canvas.getByRole("button", { name: "打开确认" })); const dialog = await screen.findByRole("dialog", { name: "确认操作" }); await waitFor(() => expect(dialog).toBeVisible()); await userEvent.click(canvasElement.ownerDocument.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!); await expect(dialog).toBeVisible(); await userEvent.click(within(dialog).getByRole("button", { name: "取消操作" })); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); } };
export const PendingDismissalPolicy: Story = {
  render: function PendingExample() { const [open, setOpen] = useState(false), [pending, setPending] = useState(true); return <Dialog open={open} onOpenChange={(next, details) => { if (!next && pending) { details.cancel(); return; } setOpen(next); }}><DialogTrigger render={<Button onClick={() => setPending(true)} />}>打开提交会话</DialogTrigger><DialogContent><DialogHeader><DialogTitle>正在提交</DialogTitle></DialogHeader><Button onClick={() => setPending(false)}>允许关闭</Button><Button onClick={() => setOpen(false)}>完成提交</Button></DialogContent></Dialog>; },
  play: async ({ canvasElement }) => { const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body), trigger = canvas.getByRole("button", { name: "打开提交会话" }); await userEvent.click(trigger); const dialog = await screen.findByRole("dialog", { name: "正在提交" }); await userEvent.keyboard("{Escape}"); await expect(dialog).toHaveAttribute("data-open"); await userEvent.click(within(dialog).getByRole("button", { name: "关闭" })); await expect(dialog).toHaveAttribute("data-open"); await userEvent.click(canvasElement.ownerDocument.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!); await expect(dialog).toHaveAttribute("data-open"); await userEvent.click(within(dialog).getByRole("button", { name: "完成提交" })); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); await waitFor(() => expect(trigger).toHaveFocus()); await userEvent.click(trigger); const reopened = await screen.findByRole("dialog", { name: "正在提交" }); await userEvent.click(within(reopened).getByRole("button", { name: "允许关闭" })); await userEvent.keyboard("{Escape}"); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); await waitFor(() => expect(trigger).toHaveFocus()); },
};
