import { Tooltip as Primitive } from "@base-ui/react/tooltip";
import { createContext, useContext, useState, useId, cloneElement, type ComponentProps, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { resolveClassName } from "../internal/resolve-class-name";
import { usePortalTheme } from "../internal/use-portal-theme";
import { ToolbarScopeBoundary } from "../internal/toolbar-scope";

type TooltipProps = { children: ReactNode; delayMs?: number; disabled?: boolean } & (
  | { open: boolean; onOpenChange: (open: boolean) => void; defaultOpen?: never }
  | { open?: never; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }
);
const ThemeContext = createContext<{ theme: "light" | "dark"; portalStyle: CSSProperties; delayMs: number; contentId: string }>({ theme: "light", portalStyle: {}, delayMs: 300, contentId: "" });
function Tooltip({ children, delayMs = 300, onOpenChange, ...props }: TooltipProps) {
  const contentId = useId();
  const [openingElement, setOpeningElement] = useState<Element | null>(null);
  const { anchor, theme, portalStyle } = usePortalTheme(openingElement);
  return <ThemeContext.Provider value={{ theme, portalStyle, delayMs, contentId }}><span hidden ref={anchor} /><Primitive.Root {...props} onOpenChange={(open, details) => {
    if (open) setOpeningElement(details.event.target instanceof Element ? details.event.target : null);
    onOpenChange?.(open);
  }}>{children}</Primitive.Root></ThemeContext.Provider>;
}
type TooltipTriggerProps = Omit<ComponentProps<"button">, "children" | "className" | "style"> & {
  className?: string | ((state: { open: boolean }) => string | undefined);
  style?: CSSProperties | ((state: { open: boolean }) => CSSProperties | undefined);
} & ({ asChild: true; children: ReactElement } | { asChild?: false; children?: ReactNode });
function TooltipTrigger({ asChild, children, ...props }: TooltipTriggerProps) {
  const { delayMs, contentId } = useContext(ThemeContext);
  const child = asChild ? children as ReactElement<{ "aria-describedby"?: string }> : undefined;
  const describedBy = [props["aria-describedby"], child?.props["aria-describedby"], contentId].filter(Boolean).join(" ");
  return <Primitive.Trigger {...props} aria-describedby={describedBy} delay={delayMs} render={child ? cloneElement(child, { "aria-describedby": describedBy }) : undefined}>{asChild ? undefined : children}</Primitive.Trigger>;
}
type TooltipContentProps = Omit<ComponentProps<"div">, "className" | "style" | "id" | "role"> & {
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  className?: string | ((state: { open: boolean }) => string | undefined);
  style?: CSSProperties | ((state: { open: boolean }) => CSSProperties | undefined);
};
function TooltipContent({ side = "top", align = "center", sideOffset = 6, className, ...props }: TooltipContentProps) {
  const { theme, portalStyle, contentId } = useContext(ThemeContext);
  return <ToolbarScopeBoundary><Primitive.Portal data-theme={theme} style={portalStyle}><Primitive.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={12} className="z-(--ob-z-tooltip) outline-none"><Primitive.Popup {...props} role="tooltip" id={contentId} data-slot="ob-tooltip" className={resolveClassName("max-w-[min(20rem,var(--available-width))] wrap-anywhere rounded-ob-md border border-ob-border bg-ob-popover px-3 py-2 text-ob-caption text-ob-popover-foreground shadow-sm", className)} /></Primitive.Positioner></Primitive.Portal></ToolbarScopeBoundary>;
}
export { Tooltip, TooltipTrigger, TooltipContent };
export type { TooltipProps, TooltipTriggerProps, TooltipContentProps };
