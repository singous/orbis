import { cva, type VariantProps } from "class-variance-authority";
import { Button as HeroButton } from "@heroui/react/button";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";

export const buttonVariants = cva(
  [
    "ui-button border border-transparent",
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
        sm: "ui-button--sm",
        md: "ui-button--md",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export type ButtonProps = Omit<ComponentProps<typeof HeroButton>, "variant" | "size" | "className" | "children"> &
  VariantProps<typeof buttonVariants> & {
    className?: string;
    children?: ReactNode;
    icon?: ReactNode;
    disabled?: boolean;
    title?: string;
  };

export function Button({ variant, size, icon, className, children, disabled, isDisabled, type = "button", ...props }: ButtonProps) {
  return (
    <HeroButton
      className={cn(buttonVariants({ variant, size }), className)}
      variant={variant ?? "secondary"}
      size={size ?? "md"}
      isDisabled={disabled ?? isDisabled}
      type={type}
      {...props}
    >
      {icon}
      {children}
    </HeroButton>
  );
}
