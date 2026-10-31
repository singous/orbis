import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { useState, type CSSProperties } from "react";
import { Button } from "@orbis/ui/button";
import { Select } from "@orbis/ui/select";
import { Dialog, DialogTrigger, DialogContent, DialogFooter, DialogClose, DialogPopup, DialogTitle } from "./index";

function NestedForm() {
  const [value, setValue] = useState<string | null>("");
  return <div data-theme="dark"><div data-theme="light"><Dialog>
    <DialogTrigger asChild><Button>编辑设置</Button></DialogTrigger>
    <DialogContent title="显示设置" description="为当前视图选择分组方式。">
      <Select label="分组方式" value={value} onValueChange={setValue} options={[{ value: "", label: "不分组" }, { value: "name", label: "按名称" }]} />
      <DialogFooter><DialogClose asChild><Button>取消</Button></DialogClose></DialogFooter>
    </DialogContent>
  </Dialog></div></div>;
}
const meta = { title: "Primitives/Dialog", component: NestedForm } satisfies Meta<typeof NestedForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NestedSelect: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const screen = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: "编辑设置" });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "显示设置" });
    await expect(dialog.closest("[data-theme]")).toHaveAttribute("data-theme", "light");
    const select = within(dialog).getByRole("combobox", { name: "分组方式" });
    await userEvent.click(select);
    const option = await screen.findByRole("option", { name: "按名称" });
    await expect(option.closest("[data-theme]")).toHaveAttribute("data-theme", "light");
    await userEvent.keyboard("{Escape}");
    await expect(dialog).toBeVisible();
    await waitFor(() => expect(select).toHaveFocus());
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole("option", { name: "按名称" }));
    await expect(select).toHaveTextContent("按名称");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  },
};

export const LocalTokens: Story = {
  render: () => <div data-testid="theme-owner" data-theme="light" style={{ "--ob-primary": "var(--ob-danger)" } as CSSProperties}><Dialog><DialogTrigger asChild><Button>打开局部主题</Button></DialogTrigger><DialogContent title="局部主题" className={state => state.open ? "gap-6" : "gap-5"} style={state => ({ minHeight: state.open ? 160 : 120 })}><Button variant="primary">主题动作</Button></DialogContent></Dialog></div>,
  play: async ({ canvasElement }) => {
    const owner = within(canvasElement).getByTestId("theme-owner");
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole("button", { name: "打开局部主题" }));
    const dialog = await screen.findByRole("dialog", { name: "局部主题" });
    const readToken = (element: Element) => getComputedStyle(element).getPropertyValue("--ob-primary");
    await waitFor(() => expect(readToken(dialog)).toBe(readToken(owner)));
    await expect(dialog).toHaveStyle({ minHeight: "160px", gap: "24px" });
    owner.style.setProperty("--ob-primary", "var(--ob-foreground)");
    await waitFor(() => expect(readToken(dialog)).toBe(readToken(owner)));
    await userEvent.keyboard("{Escape}");
  },
};

export const TriggerTheme: Story = {
  render: () => <div data-theme="dark"><Dialog><div data-theme="light" data-testid="trigger-owner" style={{ "--ob-primary": "var(--ob-danger)" } as CSSProperties}><DialogTrigger asChild><Button>从浅色区域打开</Button></DialogTrigger></div><DialogContent title="触发位置主题"><p>浮层跟随触发区域。</p></DialogContent></Dialog></div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const owner = canvas.getByTestId("trigger-owner");
    await userEvent.click(canvas.getByRole("button", { name: "从浅色区域打开" }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "触发位置主题" });
    await expect(dialog.closest("[data-theme]")).toHaveAttribute("data-theme", "light");
    await waitFor(() => expect(getComputedStyle(dialog).getPropertyValue("--ob-primary")).toBe(getComputedStyle(owner).getPropertyValue("--ob-primary")));
    await userEvent.keyboard("{Escape}");
  },
};

export const ComposedPopup: Story = {
  render: function ComposedExample() {
    const [completed, setCompleted] = useState<boolean | null>(null);
    return <><Dialog onOpenChangeComplete={setCompleted}>
      <DialogTrigger asChild><Button>打开组合浮层</Button></DialogTrigger>
      <DialogPopup className="max-w-sm gap-3">
        <DialogTitle>组合浮层</DialogTitle>
        <p>内容布局由调用方组合，关闭与焦点仍由原语维护。</p>
        <DialogClose asChild><Button>关闭组合浮层</Button></DialogClose>
      </DialogPopup>
    </Dialog><output aria-label="浮层状态">{completed === null ? "尚未打开" : completed ? "已打开" : "已关闭"}</output></>;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const screen = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: "打开组合浮层" });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "组合浮层" });
    await waitFor(() => expect(canvas.getByLabelText("浮层状态")).toHaveTextContent("已打开"));
    await userEvent.click(within(dialog).getByRole("button", { name: "关闭组合浮层" }));
    await waitFor(() => expect(canvas.getByLabelText("浮层状态")).toHaveTextContent("已关闭"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "组合浮层" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const OutsideDismissalPolicy: Story = {
  render: () => <Dialog dismissOnOutsidePress={false}><DialogTrigger asChild><Button>打开确认</Button></DialogTrigger><DialogContent title="确认操作"><DialogClose asChild><Button>取消操作</Button></DialogClose></DialogContent></Dialog>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "打开确认" }));
    const dialog = await screen.findByRole("dialog", { name: "确认操作" });
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.click(canvasElement.ownerDocument.querySelector<HTMLElement>('[data-slot="ob-dialog-backdrop"]')!);
    await waitFor(() => expect(dialog).toBeVisible());
    await userEvent.click(within(dialog).getByRole("button", { name: "取消操作" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "确认操作" })).not.toBeInTheDocument());
  },
};
