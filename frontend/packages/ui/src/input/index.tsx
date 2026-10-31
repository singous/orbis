import { Input as Primitive } from "@base-ui/react/input";
import type { ComponentProps, CSSProperties } from "react";
import { textFocus } from "../internal/focus";
import { resolveClassName } from "../internal/resolve-class-name";

type InputState = { disabled: boolean; valid: boolean | null; touched: boolean; dirty: boolean; filled: boolean; focused: boolean };
type InputProps = Omit<ComponentProps<"input">, "className" | "style"> & {
  className?: string | ((state: InputState) => string | undefined);
  style?: CSSProperties | ((state: InputState) => CSSProperties | undefined);
};
function Input({ className, ...props }: InputProps) {
  return <Primitive {...props} data-slot="ob-input" className={resolveClassName(`w-full min-h-(--ob-control-height-lg) rounded-ob-lg border border-ob-input bg-ob-card px-3 py-2 text-sm text-ob-foreground placeholder:text-ob-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 enabled:aria-invalid:border-ob-destructive ${textFocus}`, className)} />;
}
export { Input };
export type { InputProps };
