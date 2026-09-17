import type { ReactNode } from "react";

import { cn } from "./cn";

type StatusTone = "info" | "warning" | "error" | "success";

const toneClass: Record<StatusTone, string> = {
  info: "border-[var(--border-subtle)] bg-[var(--surface-content)] text-[var(--text-secondary)]",
  warning: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]",
  error: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]",
  success: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]",
};

export function StatusMessage({
  tone = "info",
  title,
  children,
}: {
  tone?: StatusTone;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("rounded-[var(--radius-container)] border px-3 py-2 text-sm", toneClass[tone])}>
      <div className="font-semibold">{title}</div>
      {children ? <div className="mt-1 text-xs leading-5 opacity-90">{children}</div> : null}
    </div>
  );
}
