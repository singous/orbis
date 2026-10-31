import { createToastManager, ToastProvider } from "@orbis/ui/toast";
import { useEffect } from "react";

export type ToastTone = "default" | "accent" | "success" | "warning" | "danger";
export const TOAST_DURATION_MS = 4_000;
export type ToastInput = { title: string; description?: string; tone?: ToastTone };
const notifications = createToastManager();

/** 通知只展示一次操作结果，不承载业务控件，也不能设置为常驻。 */
export function showToast({ title, description, tone = "default" }: ToastInput) {
  return notifications.add({ title, description, tone, timeout: TOAST_DURATION_MS });
}
export function dismissToast(id: string) { notifications.close(id); }
export function clearToasts() { notifications.clear(); }
export function useToast() { return { toast: showToast }; }
export function Toaster() {
  useEffect(() => () => clearToasts(), []);
  return <ToastProvider manager={notifications} notificationRole="alertdialog" />;
}
