import { Popover as Primitive } from "@base-ui/react/popover";
import { createContext, useContext, useState, type ComponentProps, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from "react";
import { controlFocus } from "../internal/focus";
import { resolveClassName } from "../internal/resolve-class-name";
import { usePortalTheme } from "../internal/use-portal-theme";
import { ToolbarScopeBoundary } from "../internal/toolbar-scope";

type PopoverProps = { children: ReactNode; modal?: boolean | "trap-focus" } & (
  | { open: boolean; onOpenChange: (open: boolean) => void; defaultOpen?: never }
  | { open?: never; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }
);
const ThemeContext = createContext<{ theme: "light" | "dark"; portalStyle: CSSProperties }>({ theme: "light", portalStyle: {} });
function Popover({ children, onOpenChange, ...props }: PopoverProps) {
  const [openingElement, setOpeningElement] = useState<Element | null>(null);
  const { anchor, theme, portalStyle } = usePortalTheme(openingElement);
  return <ThemeContext.Provider value={{ theme, portalStyle }}><span hidden ref={anchor} /><Primitive.Root {...props} onOpenChange={(open, details) => {
    if (open) setOpeningElement(details.event.target instanceof Element ? details.event.target : null);
    onOpenChange?.(open);
  }}>{children}</Primitive.Root></ThemeContext.Provider>;
}
type PopoverTriggerProps = Omit<ComponentProps<"button">, "children" | "className" | "style"> & {
  className?: string | ((state: { open: boolean; disabled: boolean }) => string | undefined);
  style?: CSSProperties | ((state: { open: boolean; disabled: boolean }) => CSSProperties | undefined);
} & ({ asChild: true; children: ReactElement } | { asChild?: false; children?: ReactNode });
function PopoverTrigger({ asChild, children, className, ...props }: PopoverTriggerProps) { return <Primitive.Trigger {...props} data-slot="ob-popover-trigger" className={resolveClassName(controlFocus, className)} render={asChild ? children : undefined}>{asChild ? undefined : children}</Primitive.Trigger>; }
type PopupState = { open: boolean; side: "top" | "bottom" | "left" | "right" | "inline-start" | "inline-end"; align: "start" | "center" | "end"; transitionStatus: "starting" | "ending" | "idle" | undefined };
type PopoverContentProps = Omit<ComponentProps<"div">, "className" | "style"> & {
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  initialFocus?: boolean | RefObject<HTMLElement | null>;
  finalFocus?: boolean | RefObject<HTMLElement | null>;
  className?: string | ((state: PopupState) => string | undefined);
  style?: CSSProperties | ((state: PopupState) => CSSProperties | undefined);
};
function PopoverContent({ side = "bottom", align = "start", sideOffset = 6, className, ...props }: PopoverContentProps) {
  const { theme, portalStyle } = useContext(ThemeContext);
  return <ToolbarScopeBoundary><Primitive.Portal data-theme={theme} style={portalStyle}><Primitive.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={12} className="z-(--ob-z-popover) outline-none"><Primitive.Popup {...props} data-slot="ob-popover" className={resolveClassName("max-h-(--available-height) overflow-y-auto rounded-ob-lg border border-ob-border bg-ob-popover p-4 text-ob-popover-foreground shadow-lg outline-none", className)} /></Primitive.Positioner></Primitive.Portal></ToolbarScopeBoundary>;
}
type PopoverCloseProps = Omit<ComponentProps<"button">, "children" | "className" | "style"> & {
  className?: string | ((state: { disabled: boolean }) => string | undefined);
  style?: CSSProperties | ((state: { disabled: boolean }) => CSSProperties | undefined);
} & ({ asChild: true; children: ReactElement } | { asChild?: false; children?: ReactNode });
function PopoverClose({ asChild, children, disabled = false, className, style, ...props }: PopoverCloseProps) {
  const state = { disabled };
  return <Primitive.Close {...props} disabled={disabled} className={typeof className === "function" ? className(state) : className} style={typeof style === "function" ? style(state) : style} render={asChild ? children : undefined}>{asChild ? undefined : children}</Primitive.Close>;
}
export { Popover, PopoverTrigger, PopoverContent, PopoverClose };
export type { PopoverProps, PopoverTriggerProps, PopoverContentProps, PopoverCloseProps };
