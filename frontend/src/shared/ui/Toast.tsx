import { DEFAULT_TOAST_TIMEOUT, Toast as HeroToast } from "@heroui/react/toast";
import { toast as heroToast } from "@heroui/react/toast";
import { Children, isValidElement, useEffect, useRef, type ReactNode } from "react";

export type ToastTone = "default" | "accent" | "success" | "warning" | "danger";

export type ToastInput = {
  title: string;
  description?: ReactNode;
  tone?: ToastTone;
  action?: { label: string; onPress: () => void };
  timeout?: number;
};

export function showToast({ title, description, tone = "default", action, timeout }: ToastInput) {
  return heroToast(title, {
    description,
    variant: tone,
    actionProps: action ? { children: action.label, onPress: action.onPress } : undefined,
    timeout,
  });
}

export function dismissToast(id: string) {
  heroToast.close(id);
}

export function useToast() {
  return { toast: showToast };
}

function notificationText(content: ReactNode): string {
  let text = "";
  Children.forEach(content, child => {
    if (typeof child === "string" || typeof child === "number") text += child;
    else if (isValidElement<{ children?: ReactNode }>(child)) text += notificationText(child.props.children);
  });
  return text;
}

/** 将页面状态同步到 HeroUI 队列；不在页面中渲染提示或占据布局。 */
export function ToastNotification({ title, children, tone = "default", timeout }: {
  title: string;
  children?: ReactNode;
  tone?: ToastTone;
  timeout?: number;
}) {
  const notification = useRef<{ id: string | null; dismissed: boolean; message: string; timeout?: number }>({ id: null, dismissed: false, message: "" });
  const message = JSON.stringify([title, tone, notificationText(children)]);

  useEffect(() => () => {
    const current = notification.current;
    const id = current.id;
    current.id = null;
    current.dismissed = false;
    if (id) dismissToast(id);
  }, []);

  // 更新操作回调及禁用状态，同时保留倒计时和用户主动关闭的状态。
  useEffect(() => {
    const current = notification.current;
    const changed = current.message !== message || current.timeout !== timeout;
    if (changed) current.dismissed = false;
    current.message = message;
    current.timeout = timeout;
    if (current.dismissed) return;
    const options = { description: children, variant: tone };
    if (current.id) {
      current.id = heroToast.update(current.id, title, {
        ...options,
        ...(changed ? { timeout: timeout ?? DEFAULT_TOAST_TIMEOUT } : {}),
      });
    } else {
      const id = heroToast(title, {
        ...options,
        timeout,
        onClose: () => {
          if (current.id !== id) return;
          current.id = null;
          current.dismissed = true;
        },
      });
      current.id = id;
    }
  });

  return null;
}

export function Toaster() {
  useEffect(() => () => heroToast.clear(), []);
  return <HeroToast.Provider placement="bottom end" width={360} aria-label="通知" />;
}
