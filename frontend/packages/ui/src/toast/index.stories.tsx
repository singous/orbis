import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { useState } from "react";
import { Button } from "@orbis/ui/button";
import { createToastManager, Toaster } from "./index";

function Notifications() {
  const [manager] = useState(createToastManager);
  return <Toaster toastManager={manager}><Button onClick={() => manager.add({ title: "保存失败", description: "服务暂不可用，请重试", type: "error", timeout: 0 })}>显示通知</Button></Toaster>;
}
const meta = { title: "Primitives/Toast", component: Notifications } satisfies Meta<typeof Notifications>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Dismissal: Story = { play: async ({ canvasElement }) => {
  const screen = within(canvasElement.ownerDocument.body);
  await userEvent.click(within(canvasElement).getByRole("button", { name: "显示通知" }));
  const notice = await screen.findByRole("dialog", { name: "保存失败" });
  await expect(notice).toHaveAccessibleDescription("服务暂不可用，请重试");
  await userEvent.hover(notice);
  await userEvent.click(await within(notice).findByRole("button", { name: "关闭通知" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
} };

function TypeExamples() {
  const [manager] = useState(createToastManager);
  return <Toaster toastManager={manager}>{["success", "error", "warning"].map(type => <Button key={type} onClick={() => { manager.close(); manager.add({ title: type, type, timeout: 0 }); }}>{type}</Button>)}</Toaster>;
}
export const Types: Story = { render: () => <TypeExamples />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body);
  for (const type of ["success", "error", "warning"]) {
    await userEvent.click(canvas.getByRole("button", { name: type }));
    const notice = await screen.findByRole("dialog", { name: type });
    await expect(notice.querySelector("svg")).not.toBeNull();
    await userEvent.hover(notice);
  await userEvent.click(await within(notice).findByRole("button", { name: "关闭通知" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: type })).not.toBeInTheDocument());
  }
} };
export const DarkTypes: Story = { ...Types, globals: { theme: "dark" } };

function UpdatableNotice() {
  const [manager] = useState(createToastManager);
  const [id, setId] = useState<string | null>(null);
  return <Toaster toastManager={manager}><Button onClick={() => setId(manager.add({ title: "准备中", timeout: 0 }))}>添加</Button><Button disabled={!id} onClick={() => { if (id) manager.update(id, { title: "已完成", type: "success" }); }}>更新</Button><Button onClick={() => manager.close()}>清空</Button></Toaster>;
}
export const UpdateAndClose: Story = { render: () => <UpdatableNotice />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), screen = within(canvasElement.ownerDocument.body);
  await userEvent.click(canvas.getByRole("button", { name: "添加" }));
  await screen.findByRole("dialog", { name: "准备中" });
  await userEvent.click(canvas.getByRole("button", { name: "更新" }));
  await screen.findByRole("dialog", { name: "已完成" });
  await expect(screen.getAllByRole("dialog")).toHaveLength(1);
  await userEvent.click(canvas.getByRole("button", { name: "清空" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
} };

function UrgentNotice({ timeout = 0 }: { timeout?: number }) {
  const [manager] = useState(createToastManager);
  return <Toaster toastManager={manager}><Button onClick={() => manager.add({ title: "连接中断", description: "请稍后重试", priority: "high", type: "error", timeout, actionProps: { children: "重试连接" } })}>显示紧急通知</Button></Toaster>;
}

export const IdleHighPriority: Story = { render: () => <UrgentNotice />, play: async ({ canvasElement }) => {
  const document = canvasElement.ownerDocument;
  await userEvent.click(within(canvasElement).getByRole("button", { name: "显示紧急通知" }));
  await within(document.body).findByRole("alert");
  const notice = document.querySelector<HTMLElement>('[data-slot="toast"]')!;
  await expect(notice).toHaveAttribute("aria-hidden", "true");
  await expect(notice).toHaveAttribute("tabindex", "-1");
  await expect(notice.querySelector('[data-slot="toast-action"]')).toHaveAttribute("tabindex", "-1");
  await expect(notice.querySelector('[data-slot="toast-close"]')).toHaveAttribute("tabindex", "-1");
  await expect(document.querySelector("[data-base-ui-focus-guard]")).toBeNull();
} };
export const DarkIdleHighPriority: Story = { ...IdleHighPriority, globals: { theme: "dark" } };

export const KeyboardReachability: Story = {
  render: () => <UrgentNotice />,
  // 原生哨兵同步重定向焦点，不承载交互；上游 mui/base-ui#4668。初始未聚焦状态由 IdleHighPriority 全页检查。
  parameters: { a11y: { context: { exclude: ["[data-base-ui-focus-guard]"] } } },
  play: async ({ canvasElement }) => {
    const document = canvasElement.ownerDocument, screen = within(document.body);
    const launch = within(canvasElement).getByRole("button", { name: "显示紧急通知" });
    await userEvent.click(launch);
    await screen.findByRole("alert");
    await userEvent.keyboard("{F6}");
    await expect(screen.getByRole("region", { name: "通知" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect(launch).toHaveFocus();
    await userEvent.keyboard("{F6}");
    await userEvent.tab();
    const notice = await screen.findByRole("alertdialog", { name: "连接中断" });
    await expect(notice).toHaveFocus();
    await expect(notice).not.toHaveAttribute("aria-hidden", "true");
    await userEvent.tab();
    await expect(within(notice).getByRole("button", { name: "重试连接" })).toHaveFocus();
    await userEvent.tab();
    await expect(within(notice).getByRole("button", { name: "关闭通知" })).toHaveFocus();
    await expect(document.activeElement).not.toHaveAttribute("data-base-ui-focus-guard");
  },
};

export const KeyboardDismissal: Story = { render: () => <UrgentNotice />, play: async ({ canvasElement }) => {
  const screen = within(canvasElement.ownerDocument.body);
  await userEvent.click(within(canvasElement).getByRole("button", { name: "显示紧急通知" }));
  await screen.findByRole("alert");
  await userEvent.keyboard("{F6}");
  await userEvent.tab();
  const notice = await screen.findByRole("alertdialog", { name: "连接中断" });
  await userEvent.tab();
  await userEvent.tab();
  await expect(within(notice).getByRole("button", { name: "关闭通知" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
} };

export const PointerFocus: Story = { render: () => <UrgentNotice />, play: async ({ canvasElement }) => {
  const document = canvasElement.ownerDocument;
  await userEvent.click(within(canvasElement).getByRole("button", { name: "显示紧急通知" }));
  await within(document.body).findByRole("alert");
  const notice = document.querySelector<HTMLElement>('[data-slot="toast"]')!;
  await userEvent.click(notice);
  await expect(notice).toHaveFocus();
  await expect(notice).not.toHaveAttribute("aria-hidden", "true");
} };

export const AutomaticDismissal: Story = { render: () => <UrgentNotice timeout={250} />, play: async ({ canvasElement }) => {
  const document = canvasElement.ownerDocument;
  await userEvent.click(within(canvasElement).getByRole("button", { name: "显示紧急通知" }));
  await within(document.body).findByRole("alert");
  await waitFor(() => expect(document.querySelector('[data-slot="toast"]')).toBeNull());
} };
