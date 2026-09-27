import { Toast as HeroToast } from "@heroui/react/toast";
import { toast as heroToast } from "@heroui/react/toast";

export type ToastTone = "default" | "success" | "danger";

export type ToastInput = {
  title: string;
  description?: string;
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

export function Toaster() {
  return <HeroToast.Provider placement="bottom end" width={320} />;
}
