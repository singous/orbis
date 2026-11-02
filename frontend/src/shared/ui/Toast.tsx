import { createToastManager, Toaster as NativeToaster } from "@orbis/ui/toast";
import { useEffect } from "react";

export type ToastTone = "default" | "accent" | "success" | "warning" | "danger";
export const TOAST_DURATION_MS = 4_000;
export type ToastInput = { title: string; description?: string; tone?: ToastTone };
const notifications = createToastManager();
const queued = new Map<string, ToastInput>();
let mounted = false;
let nextId = 0;

function publish(id: string, { title, description, tone = "default" }: ToastInput) {
  const type = tone === "danger" ? "error" : tone === "accent" ? "info" : tone;
  notifications.add({ id, title, description, type, priority: tone === "danger" ? "high" : "low", timeout: TOAST_DURATION_MS });
}

/** 通知只展示一次操作结果，不承载业务控件，也不能设置为常驻。 */
export function showToast({ title, description, tone = "default" }: ToastInput) {
  const id = `orbis-notification-${++nextId}`;
  const notification = { title, description, tone };
  if (mounted) publish(id, notification);
  else queued.set(id, notification);
  return id;
}
export function dismissToast(id: string) { queued.delete(id); notifications.close(id); }
export function clearToasts() { queued.clear(); notifications.close(); }
export function useToast() { return { toast: showToast }; }
export function Toaster() {
  useEffect(() => {
    mounted = true;
    for (const [id, notification] of queued) publish(id, notification);
    queued.clear();
    return () => { mounted = false; clearToasts(); };
  }, []);
  return <NativeToaster toastManager={notifications} timeout={TOAST_DURATION_MS} />;
}
