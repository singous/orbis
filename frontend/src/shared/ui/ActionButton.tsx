import { Spinner } from "@heroui/react/spinner";
import { Button as HeroButton } from "@heroui/react/button";
import type { ComponentProps, ReactNode, AriaRole, HTMLAttributes } from "react";

import { cn } from "./cn";

type ActionButtonProps = Omit<ComponentProps<typeof HeroButton>, "className" | "children" | "render"> & {
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  title?: string;
  role?: AriaRole;
  "aria-selected"?: HTMLAttributes<HTMLButtonElement>["aria-selected"];
  contentEditable?: HTMLAttributes<HTMLButtonElement>["contentEditable"];
};

/** HeroUI interaction semantics for controls whose shape belongs to a feature layout. */
export function ActionButton({ className, children, disabled, isDisabled, isPending = false, title, role, "aria-selected": ariaSelected, contentEditable, variant = "ghost", type = "button", ...props }: ActionButtonProps) {
  return <HeroButton variant={variant} className={cn("orbis-action-button", className)} isDisabled={isPending ? true : disabled ?? isDisabled} isPending={isPending} aria-busy={isPending || undefined} type={type} render={(domProps) => <button {...domProps} role={role ?? domProps.role} aria-selected={ariaSelected ?? domProps["aria-selected"]} contentEditable={contentEditable} aria-busy={isPending || undefined} title={title} />} {...props}>{isPending ? <Spinner size="sm" color="current" className="action-pending-spinner" aria-hidden="true" /> : null}{children}</HeroButton>;
}
