import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "./cn";

const iconButtonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center",
    "transition-colors duration-100",
    "disabled:pointer-events-none disabled:opacity-40",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
  ],
  {
    variants: {
      variant: {
        ghost: "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
        subtle:
          "bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:bg-[var(--surface-active)] hover:text-[var(--text-primary)]",
        inverse: "bg-[var(--surface-inverse)] text-[var(--text-oninverse)] hover:bg-[var(--surface-inverse-hover)]",
      },
      size: {
        sm: "h-7 w-7 rounded-[var(--radius-control)]",
        md: "h-8 w-8 rounded-[var(--radius-control)]",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "md",
    },
  },
);

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> &
  VariantProps<typeof iconButtonVariants> & {
    /** Required — icon-only buttons must always expose an accessible name. */
    "aria-label": string;
  };

export function IconButton({ variant, size, className, type = "button", ...props }: IconButtonProps) {
  return <button className={cn(iconButtonVariants({ variant, size }), className)} type={type} {...props} />;
}
