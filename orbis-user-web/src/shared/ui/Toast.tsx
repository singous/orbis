import * as RadixToast from "@radix-ui/react-toast";
import { create } from "zustand";

import { cn } from "./cn";

export type ToastTone = "default" | "success" | "danger";

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
};

type ToastItem = ToastInput & { id: number };

type ToastState = {
  toasts: ToastItem[];
  push: (toast: ToastInput) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

/** Show a toast from anywhere: `const { toast } = useToast();` */
export function useToast() {
  const push = useToastStore((state) => state.push);
  return { toast: push };
}

const toneClass: Record<ToastTone, string> = {
  default: "border-[var(--border-inverse)] bg-[var(--surface-inverse)] text-[var(--text-oninverse)]",
  success: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]",
  danger: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]",
};

/** Mount once near the app root; renders all queued toasts. */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <RadixToast.Provider swipeDirection="right">
      {toasts.map(({ id, title, description, tone = "default" }) => (
        <RadixToast.Root
          key={id}
          onOpenChange={(open) => {
            if (!open) {
              dismiss(id);
            }
          }}
          className={cn(
            "rounded-[var(--radius-pop)] border px-4 py-3 shadow-[var(--shadow-pop)]",
            toneClass[tone],
          )}
        >
          <RadixToast.Title className="text-sm font-semibold">{title}</RadixToast.Title>
          {description ? <RadixToast.Description className="mt-1 text-xs opacity-90">{description}</RadixToast.Description> : null}
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className="fixed bottom-6 right-6 z-[70] flex w-80 list-none flex-col gap-2 outline-none" />
    </RadixToast.Provider>
  );
}
