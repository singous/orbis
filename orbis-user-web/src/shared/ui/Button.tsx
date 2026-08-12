import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap",
    "transition-colors duration-100",
    "disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--surface-inverse)] text-[var(--text-oninverse)] hover:bg-[var(--surface-inverse-hover)]",
        secondary:
          "border border-[var(--border-subtle)] bg-[var(--surface-content)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]",
        ghost: "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
        danger: "bg-[var(--danger)] text-[var(--text-oncolor)] hover:bg-[var(--danger-strong)]",
      },
      size: {
        sm: "h-8 rounded-[var(--radius-control)] px-2.5 text-xs",
        md: "h-9 rounded-[var(--radius-control)] px-3 text-sm",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    icon?: ReactNode;
  };

export function Button({ variant, size, icon, className, children, type = "button", ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} type={type} {...props}>
      {icon}
      {children}
    </button>
  );
}
