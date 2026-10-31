import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { Button } from "@orbis/ui/button";
import { Select } from "@orbis/ui/select";
import { Dialog, DialogContent, DialogTrigger } from "@orbis/ui/dialog";
import { Toolbar } from "./index";

const meta = { title: "Primitives/Toolbar", component: Toolbar } satisfies Meta<typeof Toolbar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Navigation: Story = {
  render: () => <><Button>工具栏之前</Button><Toolbar aria-label="格式"><Button>撤销</Button><Button disabled>不可用</Button><Select label="段落" defaultValue="text" options={[{ value: "text", label: "正文" }, { value: "heading", label: "标题" }]} /><Button>重做</Button></Toolbar><Button>工具栏之后</Button></>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const undo = canvas.getByRole("button", { name: "撤销" });
    const redo = canvas.getByRole("button", { name: "重做" });
    const select = canvas.getByRole("combobox", { name: "段落" });
    undo.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(select).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(redo).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(undo).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(redo).toHaveFocus();
    await userEvent.click(select);
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "标题" }));
    await expect(select).toHaveTextContent("标题");
    await waitFor(() => expect(select).toHaveFocus());
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "工具栏之后" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect(select).toHaveFocus();
  },
};
export const Vertical: Story = {
  render: () => <Toolbar orientation="vertical" loopFocus={false} aria-label="画板工具"><Button>选择</Button><Button>移动</Button></Toolbar>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("button", { name: "选择" });
    const second = canvas.getByRole("button", { name: "移动" });
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(second).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(second).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    await expect(first).toHaveFocus();
  },
};
export const Disabled: Story = {
  render: () => <Toolbar disabled aria-label="只读工具栏"><Button onClick={fn()}>撤销</Button><Select label="段落" defaultValue="text" options={[{ value: "text", label: "正文" }]} /></Toolbar>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "撤销" })).toBeDisabled();
    await expect(canvas.getByRole("combobox", { name: "段落" })).toBeDisabled();
  },
};
export const PortalIsolation: Story = {
  render: () => <Toolbar aria-label="编辑工具"><Dialog><DialogTrigger asChild><Button>打开设置</Button></DialogTrigger><DialogContent title="设置"><Button>保存</Button><Button>取消</Button></DialogContent></Dialog><Button>插入</Button></Toolbar>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const screen = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole("button", { name: "打开设置" });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "设置" });
    const save = within(dialog).getByRole("button", { name: "保存" });
    save.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(save).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("button", { name: "插入" })).toHaveFocus();
  },
};
