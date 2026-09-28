import { cva, type VariantProps } from "class-variance-authority";
import { Spinner } from "@heroui/react/spinner";
import { Button as HeroButton } from "@heroui/react/button";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";

export const buttonVariants = cva("button ui-button", {
  variants: {
    variant: {
      primary: "button--primary",
      secondary: "button--secondary",
      ghost: "button--ghost",
      danger: "button--danger",
    },
    size: { sm: "button--sm ui-button--sm", md: "button--md ui-button--md" },
  },
  defaultVariants: { variant: "secondary", size: "md" },
});

export type ButtonProps = Omit<ComponentProps<typeof HeroButton>, "variant" | "size" | "className" | "children" | "render"> &
  VariantProps<typeof buttonVariants> & {
    className?: string;
    children?: ReactNode;
    icon?: ReactNode;
    disabled?: boolean;
    title?: string;
  };

export function Button({ variant, size, icon, className, children, disabled, isDisabled, isPending = false, title, type = "button", ...props }: ButtonProps) {
  return (
    <HeroButton
      className={cn(buttonVariants({ variant, size }), className)}
      variant={variant ?? "secondary"}
      size={size ?? "md"}
      isDisabled={isPending ? true : disabled ?? isDisabled}
      isPending={isPending}
      aria-busy={isPending || undefined}
      type={type}
      render={(domProps) => <button {...domProps} aria-busy={isPending || undefined} title={title} />}
      {...props}
    >
      {isPending ? <Spinner size="sm" color="current" aria-hidden="true" /> : icon}
      {children}
    </HeroButton>
  );
}
