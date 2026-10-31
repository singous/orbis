import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { useState } from "react";
import { Button } from "@orbis/ui/button";
import { createToastManager, ToastProvider } from "./index";
function Notifications() {
  const [manager] = useState(createToastManager);
  return <ToastProvider manager={manager}><Button onClick={() => manager.add({ title: "保存失败", description: "服务暂不可用，请重试" })}>显示通知</Button></ToastProvider>;
}
const meta = { title: "Primitives/Toast", component: Notifications } satisfies Meta<typeof Notifications>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Dismissal: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const screen = within(canvasElement.ownerDocument.body);
  await userEvent.click(canvas.getByRole("button", { name: "显示通知" }));
  const notice = await screen.findByRole("dialog", { name: "保存失败" });
  await expect(notice).toHaveAccessibleDescription("服务暂不可用，请重试");
  await userEvent.click(within(notice).getByRole("button", { name: "关闭通知" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
} };

function ToneExamples() {
  const [manager] = useState(createToastManager);
  return <ToastProvider manager={manager}>{(["success", "danger", "warning"] as const).map(tone => <Button key={tone} onClick={() => { manager.clear(); manager.add({ title: tone, tone }); }}>{tone}</Button>)}</ToastProvider>;
}
export const Tones: Story = { render: () => <ToneExamples />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const screen = within(canvasElement.ownerDocument.body);
  const colors: string[] = [];
  for (const tone of ["success", "danger", "warning"]) {
    await userEvent.click(canvas.getByRole("button", { name: tone }));
    const notice = await screen.findByRole("dialog", { name: tone });
    const title = within(notice).getByRole("heading", { name: tone });
    colors.push(getComputedStyle(title).color);
    await expect(notice.querySelector('[data-slot="ob-toast-indicator"] svg')).not.toBeNull();
    await userEvent.click(within(notice).getByRole("button", { name: "关闭通知" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: tone })).not.toBeInTheDocument());
  }
  await expect(new Set(colors).size).toBe(3);
} };
export const DarkTones: Story = { ...Tones, globals: { theme: "dark" } };

function UpdatableNotice() {
  const [manager] = useState(createToastManager);
  const [id] = useState(() => manager.add({ title: "准备中", timeout: 0 }));
  return <ToastProvider manager={manager}><Button onClick={() => manager.update(id, { title: "已完成", tone: "success" })}>更新</Button><Button onClick={() => manager.clear()}>清空</Button></ToastProvider>;
}
export const QueuedUpdate: Story = { render: () => <UpdatableNotice />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const screen = within(canvasElement.ownerDocument.body);
  await screen.findByRole("dialog", { name: "准备中" });
  await userEvent.click(canvas.getByRole("button", { name: "更新" }));
  await screen.findByRole("dialog", { name: "已完成" });
  await expect(screen.getAllByRole("dialog")).toHaveLength(1);
  await userEvent.click(canvas.getByRole("button", { name: "清空" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
} };
