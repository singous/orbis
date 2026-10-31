import { useState, type ComponentProps } from "react";
import { Button } from "../button";
import { cn } from "../cn";

type ToggleProps = Omit<ComponentProps<"button">, "onChange" | "aria-pressed"> & (
  | { pressed: boolean; onPressedChange: (pressed: boolean) => void; defaultPressed?: never }
  | { pressed?: never; defaultPressed?: boolean; onPressedChange?: (pressed: boolean) => void }
);
function Toggle({ pressed, defaultPressed = false, onPressedChange, onClick, className, ...props }: ToggleProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultPressed);
  const selected = pressed ?? uncontrolled;
  return <Button {...props} appearance="unstyled" aria-pressed={selected} className={cn("inline-flex min-h-(--ob-control-height-sm) items-center justify-center gap-2 rounded-ob-sm px-2 text-sm text-ob-foreground aria-pressed:bg-ob-accent disabled:opacity-50", className)} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (pressed === undefined) setUncontrolled(!selected);
    onPressedChange?.(!selected);
  }} />;
}
export { Toggle };
export type { ToggleProps };
