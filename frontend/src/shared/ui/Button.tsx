import type { VariantProps } from "class-variance-authority";
import { Button as PrimitiveButton } from "@orbis/ui/button";
import { Spinner } from "@orbis/ui/spinner";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@orbis/ui/cn";
import { useLegacyButtonEvents, type LegacyButtonEvents } from "./legacy-button-events";

import { compatibleButtonVariants } from "./control-styles";

export const buttonVariants = compatibleButtonVariants;

export type ButtonProps = Omit<ComponentProps<"button">, "children"> & LegacyButtonEvents & VariantProps<typeof buttonVariants> & {
  children?: ReactNode;
  icon?: ReactNode;
  isDisabled?: boolean;
  isPending?: boolean;
};
export function Button({ variant, size, icon, className, children, disabled, isDisabled, isPending = false, type = "button", onPress, onClick, onKeyDown, onPointerDown, ...props }: ButtonProps) {
  const events = useLegacyButtonEvents({ onPress, onClick, onKeyDown, onPointerDown });
  return <PrimitiveButton {...props} {...events} appearance="unstyled" type={type} disabled={isPending || (disabled ?? isDisabled)} aria-busy={isPending || undefined} data-pending={isPending || undefined} className={cn(buttonVariants({ variant: variant ?? "secondary", size: size ?? "md" }), className)}>
    {isPending ? <Spinner size="sm" color="current" aria-hidden="true" /> : icon}{children}
  </PrimitiveButton>;
}
