import { Menu as Primitive } from "@base-ui/react/menu";
import { createContext, useContext, useState, type ComponentProps, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from "react";
import { cn } from "../cn";
import { controlFocus } from "../internal/focus";
import { resolveClassName } from "../internal/resolve-class-name";
import { usePortalTheme } from "../internal/use-portal-theme";
import { ToolbarScopeBoundary } from "../internal/toolbar-scope";

type DropdownMenuProps = { children: ReactNode } & (
  | { open: boolean; onOpenChange: (open: boolean) => void; defaultOpen?: never }
  | { open?: never; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }
);
const ThemeContext = createContext<{ theme: "light" | "dark"; portalStyle: CSSProperties }>({ theme: "light", portalStyle: {} });
function DropdownMenu({ onOpenChange, children, ...props }: DropdownMenuProps) {
  const [openingElement, setOpeningElement] = useState<Element | null>(null);
  const { anchor, theme, portalStyle } = usePortalTheme(openingElement);
  return <ThemeContext.Provider value={{ theme, portalStyle }}><span hidden ref={anchor} /><Primitive.Root {...props} onOpenChange={(open, details) => {
    if (open) setOpeningElement(details.event.target instanceof Element ? details.event.target : null);
    onOpenChange?.(open);
  }}>{children}</Primitive.Root></ThemeContext.Provider>;
}
type DropdownMenuTriggerProps = Omit<ComponentProps<"button">, "children" | "className" | "style"> & {
  className?: string | ((state: { disabled: boolean; open: boolean }) => string | undefined);
  style?: CSSProperties | ((state: { disabled: boolean; open: boolean }) => CSSProperties | undefined);
} & ({ asChild: true; children: ReactElement } | { asChild?: false; children?: ReactNode });
function DropdownMenuTrigger({ asChild, children, className, ...props }: DropdownMenuTriggerProps) {
  return <Primitive.Trigger {...props} data-slot="ob-dropdown-trigger" className={resolveClassName(controlFocus, className)} render={asChild ? children : undefined}>{asChild ? undefined : children}</Primitive.Trigger>;
}
type PopupState = { open: boolean; side: "top" | "bottom" | "left" | "right" | "inline-start" | "inline-end"; align: "start" | "center" | "end"; transitionStatus: "starting" | "ending" | "idle" | undefined };
type DropdownMenuContentProps = Omit<ComponentProps<"div">, "className" | "style"> & {
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  finalFocus?: boolean | RefObject<HTMLElement | null>;
  className?: string | ((state: PopupState) => string | undefined);
  style?: CSSProperties | ((state: PopupState) => CSSProperties | undefined);
};
function DropdownMenuContent({ side = "bottom", align = "start", sideOffset = 6, className, ...props }: DropdownMenuContentProps) {
  const { theme, portalStyle } = useContext(ThemeContext);
  return <ToolbarScopeBoundary><Primitive.Portal data-theme={theme} style={portalStyle}><Primitive.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={12} className="z-(--ob-z-popover) outline-none"><Primitive.Popup {...props} data-slot="ob-dropdown-menu" className={resolveClassName("min-w-40 max-h-(--available-height) overflow-y-auto rounded-ob-lg border border-ob-border bg-ob-popover p-1 text-ob-popover-foreground shadow-lg outline-none scroll-p-1", className)} /></Primitive.Positioner></Primitive.Portal></ToolbarScopeBoundary>;
}
type ItemState = { disabled: boolean; highlighted: boolean };
type ItemAttributes<State> = Omit<ComponentProps<"div">, "children" | "className" | "style" | "onSelect"> & {
  children?: ReactNode;
  disabled?: boolean;
  textValue?: string;
  variant?: "default" | "danger";
  closeOnSelect?: boolean;
  onSelect?: () => void;
  className?: string | ((state: State) => string | undefined);
  style?: CSSProperties | ((state: State) => CSSProperties | undefined);
};
const itemClasses = `flex min-h-(--ob-control-height-md) items-center gap-2 rounded-ob-sm px-3 py-2 text-sm outline-none select-none data-highlighted:bg-ob-accent data-disabled:cursor-not-allowed data-disabled:opacity-50 ${controlFocus} focus-visible:outline-offset-[-2px]`;
type DropdownMenuItemProps = Omit<ItemAttributes<ItemState>, "children"> & ({ asChild: true; children: ReactElement } | { asChild?: false; children?: ReactNode });
function DropdownMenuItem({ asChild, children, onSelect, onClick, textValue, variant = "default", closeOnSelect = true, className, ...props }: DropdownMenuItemProps) {
  return <Primitive.Item {...props} label={textValue} closeOnClick={closeOnSelect} render={asChild ? children : undefined} data-slot="ob-dropdown-item" className={resolveClassName(cn(itemClasses, variant === "danger" && "text-ob-danger-text"), className)} onClick={event => { onClick?.(event); if (!event.defaultPrevented) onSelect?.(); }}>{asChild ? undefined : children}</Primitive.Item>;
}
type DropdownMenuGroupProps = ComponentProps<"div">;
function DropdownMenuGroup(props: DropdownMenuGroupProps) { return <Primitive.Group {...props} data-slot="ob-dropdown-group" />; }
type DropdownMenuLabelProps = ComponentProps<"div">;
function DropdownMenuLabel({ className, ...props }: DropdownMenuLabelProps) { return <Primitive.GroupLabel {...props} data-slot="ob-dropdown-label" className={cn("px-3 py-2 text-ob-caption font-medium text-ob-muted-foreground", className)} />; }
type DropdownMenuSeparatorProps = ComponentProps<"div">;
function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) { return <Primitive.Separator {...props} data-slot="ob-dropdown-separator" className={cn("my-1 h-px bg-ob-border", className)} />; }
type DropdownMenuRadioGroupProps<Value extends string | number> = Omit<ComponentProps<"div">, "defaultValue" | "onChange" | "className" | "style"> & {
  disabled?: boolean;
  className?: string | ((state: { disabled: boolean }) => string | undefined);
  style?: CSSProperties | ((state: { disabled: boolean }) => CSSProperties | undefined);
} & (
  | { value: Value; onValueChange: (value: Value) => void; defaultValue?: never }
  | { value?: never; defaultValue?: Value; onValueChange?: (value: Value) => void }
);
function DropdownMenuRadioGroup<Value extends string | number>({ onValueChange, ...props }: DropdownMenuRadioGroupProps<Value>) { return <Primitive.RadioGroup {...props} onValueChange={value => onValueChange?.(value)} />; }
type DropdownMenuRadioItemProps<Value extends string | number> = ItemAttributes<ItemState & { checked: boolean }> & { value: Value };
function DropdownMenuRadioItem<Value extends string | number>({ children, onSelect, onClick, textValue, variant = "default", closeOnSelect = false, className, ...props }: DropdownMenuRadioItemProps<Value>) {
  return <Primitive.RadioItem {...props} label={textValue} closeOnClick={closeOnSelect} data-slot="ob-dropdown-radio-item" className={resolveClassName(cn(itemClasses, variant === "danger" && "text-ob-danger-text"), className)} onClick={event => { onClick?.(event); if (!event.defaultPrevented) onSelect?.(); }}><span className="flex-1">{children}</span><Primitive.RadioItemIndicator aria-hidden="true">✓</Primitive.RadioItemIndicator></Primitive.RadioItem>;
}
type DropdownMenuCheckboxItemProps = ItemAttributes<ItemState & { checked: boolean }> & (
  | { checked: boolean; onCheckedChange: (checked: boolean) => void; defaultChecked?: never }
  | { checked?: never; defaultChecked?: boolean; onCheckedChange?: (checked: boolean) => void }
);
function DropdownMenuCheckboxItem({ children, onSelect, onClick, onCheckedChange, textValue, variant = "default", closeOnSelect = false, className, ...props }: DropdownMenuCheckboxItemProps) {
  return <Primitive.CheckboxItem {...props} label={textValue} closeOnClick={closeOnSelect} onCheckedChange={checked => onCheckedChange?.(checked)} data-slot="ob-dropdown-checkbox-item" className={resolveClassName(cn(itemClasses, variant === "danger" && "text-ob-danger-text"), className)} onClick={event => { onClick?.(event); if (!event.defaultPrevented) onSelect?.(); }}><span className="flex-1">{children}</span><Primitive.CheckboxItemIndicator aria-hidden="true">✓</Primitive.CheckboxItemIndicator></Primitive.CheckboxItem>;
}
export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuCheckboxItem };
export type { DropdownMenuProps, DropdownMenuTriggerProps, DropdownMenuContentProps, DropdownMenuItemProps, DropdownMenuGroupProps, DropdownMenuLabelProps, DropdownMenuSeparatorProps, DropdownMenuRadioGroupProps, DropdownMenuRadioItemProps, DropdownMenuCheckboxItemProps };
