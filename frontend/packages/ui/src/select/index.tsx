import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import { Select as Primitive } from "@base-ui/react/select";
import { useContext, useId, type ComponentProps, type CSSProperties, type AriaAttributes, type ReactNode } from "react";
import { ToolbarScopeBoundary, ToolbarScopeContext } from "../internal/toolbar-scope";
import { cn } from "../cn";
import { resolveClassName } from "../internal/resolve-class-name";
import { controlFocus } from "../internal/focus";
import { usePortalTheme } from "../internal/use-portal-theme";

type SelectState<Value> = { disabled: boolean; open: boolean; readOnly: boolean; value: Value | null; valid: boolean | null; focused: boolean };
type SelectProps<Value extends string | number> = Pick<ComponentProps<"button">, keyof AriaAttributes | "disabled" | "id" | "ref" | "autoFocus" | "onFocus" | "onBlur" | "tabIndex"> & {
  wrapperClassName?: string;
  className?: string | ((state: SelectState<Value>) => string | undefined);
  style?: CSSProperties | ((state: SelectState<Value>) => CSSProperties | undefined);
  density?: "compact" | "default" | "form";
  description?: string;
  form?: string;
  readOnly?: boolean;
  label?: string;
  name?: string;
  required?: boolean;
  placeholder?: string;
  options: readonly { value: Value; label: ReactNode; disabled?: boolean }[];
} & (
  | { value: Value | null; onValueChange: (value: Value | null) => void; defaultValue?: never }
  | { value?: never; defaultValue?: Value | null; onValueChange?: (value: Value | null) => void }
) & (
  | { open: boolean; onOpenChange: (open: boolean) => void; defaultOpen?: never }
  | { open?: never; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }
);
const densityClasses = {
  compact: "min-h-(--ob-control-height-sm) py-1",
  default: "min-h-(--ob-control-height-md) py-1.5",
  form: "min-h-(--ob-control-height-lg) py-2",
};
function Select<Value extends string | number>({ label, options, value, defaultValue, onValueChange, open, defaultOpen, onOpenChange, name, form, required, readOnly, placeholder, id, wrapperClassName, className, density = "form", description, disabled, ...props }: SelectProps<Value>) {
  const inToolbar = useContext(ToolbarScopeContext);
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const descriptionId = description ? `${generatedId}-description` : undefined;
  const describedBy = [props["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined;
  const { anchor, theme, portalStyle } = usePortalTheme();
  const triggerContent = <><Primitive.Value placeholder={placeholder} /><Primitive.Icon aria-hidden="true">⌄</Primitive.Icon></>;
  const trigger = <Primitive.Trigger {...props} id={triggerId} aria-describedby={describedBy} data-slot="ob-select-trigger" className={resolveClassName(cn("flex w-full items-center justify-between gap-3 rounded-ob-lg border border-ob-input bg-ob-card px-3 text-start disabled:cursor-not-allowed disabled:opacity-50", densityClasses[density], controlFocus), className)}>{triggerContent}</Primitive.Trigger>;
  return <div className={cn("grid gap-1.5 text-sm text-ob-foreground", wrapperClassName)}>
    <span hidden ref={anchor} />
    {label ? <label htmlFor={triggerId} className="font-medium">{label}</label> : null}
    <Primitive.Root<Value> items={options} value={value} defaultValue={defaultValue} onValueChange={next => onValueChange?.(next)} name={name} form={form} required={required} readOnly={readOnly} disabled={disabled} open={open} defaultOpen={defaultOpen} onOpenChange={next => onOpenChange?.(next)}>
      {inToolbar ? <ToolbarPrimitive.Button disabled={disabled} focusableWhenDisabled={false} render={trigger}>{triggerContent}</ToolbarPrimitive.Button> : trigger}
      <ToolbarScopeBoundary><Primitive.Portal data-theme={theme} style={portalStyle} role="region" aria-label={`${label ?? props["aria-label"] ?? "选择"}选项`}>
        <Primitive.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-(--ob-z-popover) outline-none">
          <Primitive.Popup data-slot="ob-select-popup" className="max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto rounded-ob-lg border border-ob-border bg-ob-popover p-1 text-ob-popover-foreground shadow-lg outline-none scroll-p-1">
            <Primitive.List>{options.map(option => <Primitive.Item key={option.value} value={option.value} disabled={option.disabled} data-slot="ob-select-option" className="flex min-h-(--ob-control-height-md) items-center gap-2 rounded-ob-sm px-3 py-2 text-sm outline-none data-highlighted:bg-ob-accent data-disabled:opacity-50">
              <Primitive.ItemText>{option.label}</Primitive.ItemText><Primitive.ItemIndicator className="ms-auto" aria-hidden="true">✓</Primitive.ItemIndicator>
            </Primitive.Item>)}</Primitive.List>
          </Primitive.Popup>
        </Primitive.Positioner>
      </Primitive.Portal></ToolbarScopeBoundary>
    </Primitive.Root>
    {description ? <p id={descriptionId} className="text-sm text-ob-muted-foreground">{description}</p> : null}
  </div>;
}
export { Select };
export type { SelectProps };
