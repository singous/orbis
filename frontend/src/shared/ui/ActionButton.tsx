import { Button as PrimitiveButton } from "@orbis/ui/button";
import { Spinner } from "@orbis/ui/spinner";
import type { ComponentProps } from "react";
import { cn } from "@orbis/ui/cn";
import { controlFeedbackClassName, controlTones, domainTouchTargets } from "./control-styles";
import { useLegacyButtonEvents, type LegacyButtonEvents } from "./legacy-button-events";

type ActionButtonProps = ComponentProps<"button"> & LegacyButtonEvents & { isDisabled?: boolean; isPending?: boolean; variant?: "primary" | "secondary" | "tertiary" | "ghost" | "outline" | "danger" | "danger-soft"; size?: "sm" | "md" | "lg" };
export function ActionButton({ className, children, disabled, isDisabled, isPending = false, variant = "ghost", size = "md", type = "button", onPress, onClick, onKeyDown, onPointerDown, ...props }: ActionButtonProps) {
  const events = useLegacyButtonEvents({ onPress, onClick, onKeyDown, onPointerDown });
  return <PrimitiveButton {...props} {...events} appearance="unstyled" type={type} disabled={isPending || (disabled ?? isDisabled)} aria-busy={isPending || undefined} data-pending={isPending || undefined} className={cn("button", `button--${variant}`, `button--${size}`, "orbis-action-button static inline-block h-auto w-auto min-w-0 rounded-ob-xl border-0 p-0 [font:inherit] text-start whitespace-normal [justify-content:normal] [gap:normal] [&_svg]:h-auto [&_svg]:w-auto [&_svg]:m-0 [&_svg]:self-auto", controlFeedbackClassName, domainTouchTargets, controlTones[variant], className)}>
    {isPending ? <Spinner size="sm" color="current" className="action-pending-spinner me-2 align-middle" aria-hidden="true" /> : null}{children}
  </PrimitiveButton>;
}
