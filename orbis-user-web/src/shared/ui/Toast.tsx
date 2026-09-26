import { Toast as HeroToast } from "@heroui/react/toast";
import { toast as heroToast } from "@heroui/react/toast";

export type ToastTone = "default" | "success" | "danger";

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
};

export function showToast({ title, description, tone = "default" }: ToastInput) {
  return heroToast(title, { description, variant: tone });
}

export function useToast() {
  return { toast: showToast };
}

export function Toaster() {
  return <HeroToast.Provider placement="bottom end" width={320} />;
}
