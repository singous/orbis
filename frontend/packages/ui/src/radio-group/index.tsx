import { RadioGroup as GroupPrimitive } from "@base-ui/react/radio-group";
import { Radio as Primitive } from "@base-ui/react/radio";
import type { ComponentProps, CSSProperties, ReactNode, Ref } from "react";
import { resolveClassName } from "../internal/resolve-class-name";
import { controlFocus } from "../internal/focus";

type GroupState = { disabled: boolean; readOnly: boolean; required: boolean; valid: boolean | null };
type RadioGroupProps<Value extends string | number> = Omit<ComponentProps<"div">, "defaultValue" | "onChange" | "className" | "style"> & {
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
  form?: string;
  className?: string | ((state: GroupState) => string | undefined);
  style?: CSSProperties | ((state: GroupState) => CSSProperties | undefined);
} & (
  | { value: Value; onValueChange: (value: Value) => void; defaultValue?: never }
  | { value?: never; defaultValue?: Value; onValueChange?: (value: Value) => void }
);
function RadioGroup<Value extends string | number>({ onValueChange, className, ...props }: RadioGroupProps<Value>) { return <GroupPrimitive {...props} data-slot="ob-radio-group" className={resolveClassName("grid gap-2", className)} onValueChange={value => onValueChange?.(value)} />; }
type RadioState = GroupState & { checked: boolean };
type RadioGroupItemProps<Value extends string | number> = Omit<ComponentProps<"span">, "children" | "className" | "style" | "ref"> & {
  value: Value;
  appearance?: "control" | "choice";
  children: ReactNode;
  disabled?: boolean;
  readOnly?: boolean;
  ref?: Ref<HTMLElement>;
  className?: string | ((state: RadioState) => string | undefined);
  style?: CSSProperties | ((state: RadioState) => CSSProperties | undefined);
};
function RadioGroupItem<Value extends string | number>({ children, className, appearance = "control", ...props }: RadioGroupItemProps<Value>) {
  return <Primitive.Root {...props} data-slot="ob-radio" className={resolveClassName(`${appearance === "control" ? "flex min-h-(--ob-control-height-lg) items-center gap-3 rounded-ob-md text-sm text-ob-foreground" : ""} data-disabled:cursor-not-allowed data-disabled:opacity-50 ${controlFocus}`, className)}>{appearance === "control" ? <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center rounded-full border border-ob-border"><Primitive.Indicator className="size-2 rounded-full bg-ob-primary" /></span> : null}{children}</Primitive.Root>;
}
export { RadioGroup, RadioGroupItem };
export type { RadioGroupProps, RadioGroupItemProps };
