import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, expectTypeOf, it, vi } from "vitest";
import { clearToasts, dismissToast, showToast, TOAST_DURATION_MS, Toaster, type ToastInput } from "./Toast";

afterEach(async () => {
  cleanup();
  clearToasts();
  if (vi.isFakeTimers()) { await act(() => vi.runOnlyPendingTimersAsync()); vi.useRealTimers(); }
  else await act(() => new Promise(resolve => setTimeout(resolve, 180)));
});

it("only accepts text and automatically removes notifications", async () => {
  expectTypeOf<ToastInput["description"]>().toEqualTypeOf<string | undefined>();
  vi.useFakeTimers();
  render(<Toaster />);
  act(() => { showToast({ title: "保存失败", description: "服务器返回的原因", tone: "danger" }); });
  expect(screen.getByRole("alert")).toHaveTextContent("服务器返回的原因");
  expect(document.querySelector('[data-slot="toast-title"]')).toHaveTextContent("保存失败");
  expect(document.querySelectorAll('[data-slot="toast-close"]')).toHaveLength(1);
  expect(document.querySelector('[data-slot="toast-close"]')).toHaveAttribute("aria-label", "关闭通知");
  await act(() => vi.advanceTimersByTimeAsync(TOAST_DURATION_MS + 180));
  expect(document.querySelector('[data-slot="toast"]')).not.toBeInTheDocument();
});

it("does not allow callers to make a toast permanent or attach a business action", async () => {
  vi.useFakeTimers();
  render(<Toaster />);
  const obsoleteOptions = { title: "操作失败", timeout: 0, action: { label: "重新提交", onPress: vi.fn() } };
  act(() => { showToast(obsoleteOptions); });
  expect(screen.queryByRole("button", { name: "重新提交" })).not.toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(TOAST_DURATION_MS + 180));
  expect(document.querySelector('[data-slot="toast"]')).not.toBeInTheDocument();
});

it("shows the same message for a new event after dismissal", async () => {
  vi.useFakeTimers();
  render(<Toaster />);
  let id = "";
  act(() => { id = showToast({ title: "保存失败" }); });
  act(() => dismissToast(id));
  await act(() => vi.advanceTimersByTimeAsync(180));
  expect(document.querySelector('[data-slot="toast"]')).not.toBeInTheDocument();
  act(() => { showToast({ title: "保存失败" }); });
  expect(document.querySelector('[data-slot="toast-title"]')).toHaveTextContent("保存失败");
});
