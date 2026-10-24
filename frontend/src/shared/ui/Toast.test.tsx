import { toast as heroToast } from "@heroui/react/toast";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { Button } from "./Button";
import { Dialog, DialogContent } from "./Dialog";
import { showToast, ToastNotification, Toaster } from "./Toast";

afterEach(() => {
  cleanup();
  heroToast.clear();
  vi.useRealTimers();
});

it("keeps one HeroUI toast across rerenders and updates its recovery actions", async () => {
  const retry = vi.fn();
  function Example() {
    const [version, setVersion] = useState(1);
    const [busy, setBusy] = useState(false);
    return <>
      <button onClick={() => setVersion(value => value + 1)}>更新版本</button>
      <button onClick={() => setBusy(value => !value)}>切换忙碌状态</button>
      <ToastNotification title="同步失败" tone="danger" timeout={0}>
        修改仍保存在本机。
        <Button disabled={busy} onPress={() => retry(version)}>重试同步</Button>
      </ToastNotification>
      <Toaster />
    </>;
  }
  const view = render(<Example />);
  expect(view.container.querySelector(".alert")).toBeNull();
  expect(screen.getByRole("alertdialog")).toHaveTextContent("修改仍保存在本机");
  const id = heroToast.getQueue().visibleToasts[0].key;
  fireEvent.click(screen.getByText("更新版本"));
  fireEvent.click(screen.getByText("切换忙碌状态"));
  expect(screen.getByRole("button", { name: "重试同步" })).toBeDisabled();
  fireEvent.click(screen.getByText("切换忙碌状态"));
  fireEvent.click(screen.getByRole("button", { name: "重试同步" }));
  expect(retry).toHaveBeenCalledWith(2);
  expect(heroToast.getQueue().visibleToasts.map(item => item.key)).toEqual([id]);
  view.unmount();
});

it("respects dismissal until the error changes and removes resolved notifications", async () => {
  function Example({ error }: { error: string | null }) {
    return <>{error ? <ToastNotification title="保存失败" tone="danger">{error}</ToastNotification> : null}<Toaster /></>;
  }
  const view = render(<Example error="网络连接中断" />);
  act(() => heroToast.close(heroToast.getQueue().visibleToasts[0].key));
  await waitFor(() => expect(screen.queryByText("保存失败")).not.toBeInTheDocument());
  view.rerender(<Example error="网络连接中断" />);
  expect(screen.queryByText("保存失败")).not.toBeInTheDocument();
  view.rerender(<Example error="请求字段校验失败" />);
  expect(screen.getByRole("alertdialog")).toHaveTextContent("请求字段校验失败");
  view.rerender(<Example error={null} />);
  await waitFor(() => expect(screen.queryByText("保存失败")).not.toBeInTheDocument());
});

it("does not duplicate notifications in StrictMode", async () => {
  render(<StrictMode><ToastNotification title="发现本机草稿" timeout={0} /><Toaster /></StrictMode>);
  await waitFor(() => expect(screen.getAllByText("发现本机草稿")).toHaveLength(1));
});

it("keeps recovery actions available without an automatic timeout", () => {
  vi.useFakeTimers();
  render(<><ToastNotification title="本机修改待同步" timeout={0}><Button>导出本机修改</Button></ToastNotification><Toaster /></>);
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByRole("button", { name: "导出本机修改" })).toBeInTheDocument();
});

it("leaves a modal open and its retry action usable when reporting an error", async () => {
  const retry = vi.fn();
  render(<><Dialog open onOpenChange={() => {}}><DialogContent title="文档预览">
    <ToastNotification title="文档预览加载失败" tone="danger" timeout={0}><Button onPress={retry}>重新加载预览</Button></ToastNotification>
  </DialogContent></Dialog><Toaster /></>);
  expect(await screen.findByRole("dialog", { name: "文档预览" })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "重新加载预览" }));
  expect(retry).toHaveBeenCalledOnce();
});

it("clears old session notifications when the provider is replaced", async () => {
  const view = render(<Toaster key="first-session" />);
  act(() => { showToast({ title: "第一工作空间", timeout: 0 }); });
  view.rerender(<Toaster key="second-session" />);
  await waitFor(() => expect(screen.queryByText("第一工作空间")).not.toBeInTheDocument());
});
