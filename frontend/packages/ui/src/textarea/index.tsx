import type { ComponentProps, CSSProperties } from "react";
import { cn } from "../cn";
import { textFocus } from "../internal/focus";

type TextareaState = { disabled: boolean; readOnly: boolean; invalid: boolean };
type TextareaProps = Omit<ComponentProps<"textarea">, "className" | "style"> & {
  className?: string | ((state: TextareaState) => string | undefined);
  style?: CSSProperties | ((state: TextareaState) => CSSProperties | undefined);
};
function Textarea({ className, style, ...props }: TextareaProps) {
  const state = { disabled: props.disabled ?? false, readOnly: props.readOnly ?? false, invalid: props["aria-invalid"] === true || props["aria-invalid"] === "true" };
  return <textarea {...props} style={typeof style === "function" ? style(state) : style} data-slot="ob-textarea" className={cn(`w-full min-h-(--ob-control-height-lg) resize-y rounded-ob-lg border border-ob-input bg-ob-card px-3 py-2 text-sm text-ob-foreground placeholder:text-ob-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 enabled:aria-invalid:border-ob-destructive ${textFocus}`, typeof className === "function" ? className(state) : className)} />;
}
export { Textarea };
export type { TextareaProps };
