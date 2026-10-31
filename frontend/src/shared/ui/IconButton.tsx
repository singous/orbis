import { cva, type VariantProps } from "class-variance-authority";
import { Button as PrimitiveButton } from "@orbis/ui/button";
import type { ComponentProps } from "react";
import { cn } from "@orbis/ui/cn";
import { controlFeedbackClassName, controlTones } from "./control-styles";
import { useLegacyButtonEvents, type LegacyButtonEvents } from "./legacy-button-events";
const iconItemStates = "[&:not(:disabled,[aria-disabled=true],[data-disabled=true]):is(:hover,:focus-visible,[aria-pressed=true])]:bg-(--ob-item-hover-bg) [&:not(:disabled,[aria-disabled=true],[data-disabled=true]):is(:hover,:focus-visible,[aria-pressed=true])]:text-(--ob-item-foreground) [&:not(:disabled,[aria-disabled=true],[data-disabled=true]):is(:hover,:focus-visible,[aria-pressed=true])_svg]:text-inherit";

const iconButtonVariants = cva("orbis-icon-button inline-flex shrink-0 items-center justify-center rounded-ob-xl border-0 p-0 text-sm font-medium", { variants: { variant: { ghost: "", subtle: "", inverse: "" }, size: { sm: "orbis-icon-button--compact size-(--ob-control-height-sm) min-h-(--ob-control-height-sm) min-w-(--ob-control-height-sm) [&>svg]:size-4", md: "orbis-icon-button--default size-(--ob-control-height-md) min-h-(--ob-control-height-md) min-w-(--ob-control-height-md) [&>svg]:size-4.5" } }, defaultVariants: { variant: "ghost", size: "md" } });
export type IconButtonProps = Omit<ComponentProps<"button">, "aria-label"> & LegacyButtonEvents & VariantProps<typeof iconButtonVariants> & { isDisabled?: boolean; isPending?: boolean; "aria-label": string };
export function IconButton({ variant, size, className, disabled, isDisabled, isPending = false, type = "button", onPress, onClick, onKeyDown, onPointerDown, ...props }: IconButtonProps) {
  const events = useLegacyButtonEvents({ onPress, onClick, onKeyDown, onPointerDown });
  return <PrimitiveButton {...props} {...events} appearance="unstyled" type={type} disabled={isPending || (disabled ?? isDisabled)} aria-busy={isPending || undefined} className={cn("button button--icon-only button--sm", variant === "inverse" ? "button--primary" : variant === "subtle" ? "button--tertiary" : "button--ghost", iconButtonVariants({ variant, size }), variant !== "inverse" && iconItemStates, controlFeedbackClassName, controlTones[variant === "inverse" ? "primary" : variant === "subtle" ? "tertiary" : "ghost"], className)} />;
}
