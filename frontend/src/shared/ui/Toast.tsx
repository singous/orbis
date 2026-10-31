import { Toast as HeroToast, toast as heroToast } from "@heroui/react/toast";
import { useEffect } from "react";

export type ToastTone = "default" | "accent" | "success" | "warning" | "danger";
export const TOAST_DURATION_MS = 4_000;
export type ToastInput = { title: string; description?: string; tone?: ToastTone };

/** 通知只展示一次操作结果，不承载业务控件，也不能设置为常驻。 */
export function showToast({ title, description, tone = "default" }: ToastInput) {
  return heroToast(title, { description, variant: tone, timeout: TOAST_DURATION_MS });
}
export function dismissToast(id: string) { heroToast.close(id); }
export function clearToasts() { heroToast.clear(); }
export function useToast() { return { toast: showToast }; }
export function Toaster() {
  useEffect(() => () => clearToasts(), []);
  return <HeroToast.Provider placement="bottom end" width={360} aria-label="通知" />;
}
