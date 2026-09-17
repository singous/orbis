import type { InputHTMLAttributes } from "react";

import { cn } from "./cn";

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export function TextInput({ label, className, ...props }: TextInputProps) {
  const input = (
    <input
      className={cn(
        "h-9 w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-content)] px-3 text-sm text-[var(--text-primary)]",
        "placeholder:text-[var(--text-tertiary)]",
        "focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );

  if (!label) {
    return input;
  }

  return (
    <label className="grid gap-1.5 text-sm font-medium text-[var(--text-primary)]">
      <span>{label}</span>
      {input}
    </label>
  );
}
