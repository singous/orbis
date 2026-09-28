import { Spinner } from "@heroui/react/spinner";
import { Button as HeroButton } from "@heroui/react/button";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";

type ActionButtonProps = Omit<ComponentProps<typeof HeroButton>, "className" | "children" | "render"> & {
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  title?: string;
};

/** HeroUI interaction semantics for controls whose shape belongs to a feature layout. */
export function ActionButton({ className, children, disabled, isDisabled, isPending = false, title, variant = "ghost", type = "submit", ...props }: ActionButtonProps) {
  return <HeroButton variant={variant} className={cn("orbis-action-button", className)} isDisabled={isPending ? true : disabled ?? isDisabled} isPending={isPending} aria-busy={isPending || undefined} type={type} render={(domProps) => <button {...domProps} aria-busy={isPending || undefined} title={title} />} {...props}>{isPending ? <Spinner size="sm" color="current" className="action-pending-spinner" aria-hidden="true" /> : null}{children}</HeroButton>;
}
