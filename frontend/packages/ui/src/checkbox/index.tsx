import { Checkbox as Primitive } from "@base-ui/react/checkbox";
import { useId, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { cn } from "../cn";
import { resolveClassName } from "../internal/resolve-class-name";
import { controlFocus } from "../internal/focus";

type CheckboxState = { checked: boolean; disabled: boolean; indeterminate: boolean };
type CheckboxProps = Pick<ComponentProps<"button">, "id" | "ref" | "title" | "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid"> & { children?: ReactNode; wrapperClassName?: string; className?: string | ((state: CheckboxState) => string | undefined); style?: CSSProperties | ((state: CheckboxState) => CSSProperties | undefined); disabled?: boolean; required?: boolean; form?: string; name?: string; value?: string; indeterminate?: boolean } & (
  | { checked: boolean; onCheckedChange: (checked: boolean) => void; defaultChecked?: never }
  | { checked?: never; defaultChecked?: boolean; onCheckedChange?: (checked: boolean) => void }
);
function Checkbox({ children, className, wrapperClassName, id, disabled, checked, defaultChecked, onCheckedChange, ...props }: CheckboxProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return <label htmlFor={controlId} className={cn("inline-flex items-center gap-2 text-sm text-ob-foreground", disabled && "opacity-50", wrapperClassName)}>
    <Primitive.Root nativeButton render={<button type="button" disabled={disabled} />} {...props} id={controlId} checked={checked} defaultChecked={defaultChecked} onCheckedChange={next => onCheckedChange?.(next)} disabled={disabled} data-slot="ob-checkbox" className={resolveClassName(cn("grid size-4 shrink-0 place-items-center rounded-ob-sm border border-ob-input bg-ob-card data-checked:border-ob-primary data-checked:bg-ob-primary data-checked:text-ob-primary-foreground disabled:cursor-not-allowed", controlFocus), className)}>
      <Primitive.Indicator aria-hidden="true" className="text-ob-caption">✓</Primitive.Indicator>
    </Primitive.Root>
    {children}
  </label>;
}
export { Checkbox };
export type { CheckboxProps };
