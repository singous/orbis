import { cva, type VariantProps } from "class-variance-authority";
import { Button as HeroButton } from "@heroui/react/button";
import type { ComponentProps } from "react";

import { cn } from "./cn";

const iconButtonVariants = cva("shrink-0", {
  variants: {
    variant: { ghost: "", subtle: "", inverse: "" },
    size: { sm: "h-7 w-7", md: "h-8 w-8" },
  },
  defaultVariants: { variant: "ghost", size: "md" },
});

export type IconButtonProps = Omit<ComponentProps<typeof HeroButton>, "variant" | "size" | "className" | "aria-label"> &
  VariantProps<typeof iconButtonVariants> & {
    className?: string;
    disabled?: boolean;
    /** Required — icon-only buttons must always expose an accessible name. */
    "aria-label": string;
  };

export function IconButton({ variant, size, className, disabled, isDisabled, type = "button", ...props }: IconButtonProps) {
  return <HeroButton isIconOnly variant={variant === "inverse" ? "primary" : variant === "subtle" ? "tertiary" : "ghost"} size="sm" className={cn(iconButtonVariants({ variant, size }), className)} isDisabled={disabled ?? isDisabled} type={type} {...props} />;
}
