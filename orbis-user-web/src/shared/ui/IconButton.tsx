import { cva, type VariantProps } from "class-variance-authority";
import { Button as HeroButton } from "@heroui/react/button";
import type { ComponentProps } from "react";

import { cn } from "./cn";

const iconButtonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center",
    "transition-colors duration-100",
    "disabled:pointer-events-none disabled:opacity-40",
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

export type IconButtonProps = Omit<ComponentProps<typeof HeroButton>, "variant" | "size" | "className" | "aria-label"> &
  VariantProps<typeof iconButtonVariants> & {
    className?: string;
    disabled?: boolean;
    /** Required — icon-only buttons must always expose an accessible name. */
    "aria-label": string;
  };

export function IconButton({ variant, size, className, disabled, isDisabled, type = "button", ...props }: IconButtonProps) {
  return <HeroButton isIconOnly variant="ghost" size="sm" className={cn(iconButtonVariants({ variant, size }), className)} isDisabled={disabled ?? isDisabled} type={type} {...props} />;
}
