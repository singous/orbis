import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "./cn";

const tagVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-[var(--border-subtle)] bg-[var(--surface-content)] text-[var(--text-secondary)]",
        accent: "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]",
        success: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]",
        warning: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]",
        danger: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export type TagProps = VariantProps<typeof tagVariants> & {
  className?: string;
  children: ReactNode;
};

export function Tag({ tone, className, children }: TagProps) {
  return <span className={cn(tagVariants({ tone }), className)}>{children}</span>;
}
