import { Input as HeroInput } from "@heroui/react/input";
import type { ComponentProps } from "react";

import { cn } from "./cn";

type TextInputProps = Omit<ComponentProps<typeof HeroInput>, "className"> & {
  className?: string;
  label?: string;
};

export function TextInput({ label, className, ...props }: TextInputProps) {
  const input = (
    <HeroInput
      className={cn(
        "h-9 w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-content)] px-3 text-sm text-[var(--text-primary)]",
        "placeholder:text-[var(--text-tertiary)]",
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
