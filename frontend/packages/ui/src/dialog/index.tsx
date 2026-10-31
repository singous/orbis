import { Dialog as Primitive } from "@base-ui/react/dialog";
import { createContext, useContext, useState, type ComponentProps, type CSSProperties, type RefObject, type ReactElement, type ReactNode } from "react";
import { ToolbarScopeBoundary } from "../internal/toolbar-scope";
import { cn } from "../cn";
import { resolveClassName } from "../internal/resolve-class-name";
import { controlFocus } from "../internal/focus";
import { usePortalTheme } from "../internal/use-portal-theme";

type DialogProps = { children: ReactNode; onOpenChangeComplete?: (open: boolean) => void; dismissOnOutsidePress?: boolean } & (
  | { open: boolean; onOpenChange: (open: boolean) => void; defaultOpen?: never }
  | { open?: never; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }
);
const ThemeContext = createContext<{ theme: "light" | "dark"; portalStyle: CSSProperties }>({ theme: "light", portalStyle: {} });
function Dialog({ children, onOpenChange, dismissOnOutsidePress = true, ...props }: DialogProps) {
  const [openingElement, setOpeningElement] = useState<Element | null>(null);
  const { anchor, theme, portalStyle } = usePortalTheme(openingElement);
  return <ThemeContext.Provider value={{ theme, portalStyle }}><span hidden ref={anchor} /><Primitive.Root {...props} disablePointerDismissal={!dismissOnOutsidePress} onOpenChange={(open, details) => {
    if (open) setOpeningElement(details.event.target instanceof Element ? details.event.target : null);
    onOpenChange?.(open);
  }}>{children}</Primitive.Root></ThemeContext.Provider>;
}

type DialogTriggerProps = Omit<ComponentProps<"button">, "children" | "className" | "style"> & {
  className?: string | ((state: { disabled: boolean; open: boolean }) => string | undefined);
  style?: CSSProperties | ((state: { disabled: boolean; open: boolean }) => CSSProperties | undefined);
} & ({ asChild: true; children: ReactElement } | { asChild?: false; children?: ReactNode });
function DialogTrigger({ asChild, children, className, ...props }: DialogTriggerProps) {
  return <Primitive.Trigger {...props} data-slot="ob-dialog-trigger" className={resolveClassName(controlFocus, className)} render={asChild ? children : undefined}>{asChild ? undefined : children}</Primitive.Trigger>;
}
type DialogCloseProps = Omit<ComponentProps<"button">, "children" | "className" | "style"> & {
  className?: string | ((state: { disabled: boolean }) => string | undefined);
  style?: CSSProperties | ((state: { disabled: boolean }) => CSSProperties | undefined);
} & ({ asChild: true; children: ReactElement } | { asChild?: false; children?: ReactNode });
function DialogClose({ asChild, children, ...props }: DialogCloseProps) {
  return <Primitive.Close {...props} render={asChild ? children : undefined}>{asChild ? undefined : children}</Primitive.Close>;
}
type DialogContentState = { open: boolean; transitionStatus: "starting" | "ending" | "idle" | undefined; nested: boolean; nestedDialogOpen: boolean };
type DialogPopupProps = Omit<ComponentProps<"div">, "className" | "style"> & {
  initialFocus?: boolean | RefObject<HTMLElement | null>;
  finalFocus?: boolean | RefObject<HTMLElement | null>;
  className?: string | ((state: DialogContentState) => string | undefined);
  style?: CSSProperties | ((state: DialogContentState) => CSSProperties | undefined);
  portalContainer?: HTMLElement | RefObject<HTMLElement | null> | null;
  backdropClassName?: string;
  viewportClassName?: string;
};
function DialogPopup({ className, portalContainer, backdropClassName, viewportClassName, children, ...props }: DialogPopupProps) {
  const { theme, portalStyle } = useContext(ThemeContext);
  return <ToolbarScopeBoundary><Primitive.Portal container={portalContainer} data-theme={theme} style={portalStyle}>
    <Primitive.Backdrop data-slot="ob-dialog-backdrop" className={cn("fixed inset-0 z-(--ob-z-dialog) bg-(--ob-scrim) transition-opacity duration-(--ob-motion-dialog) data-starting-style:opacity-0 data-ending-style:opacity-0", backdropClassName)} />
    <Primitive.Viewport className={cn("fixed inset-0 z-(--ob-z-dialog) grid items-center justify-items-center overflow-y-auto p-4", viewportClassName)}>
      <Primitive.Popup aria-modal="true" {...props} data-slot="ob-dialog" className={resolveClassName("relative grid w-full max-w-lg gap-5 rounded-ob-xl border border-ob-border bg-ob-card p-6 text-ob-foreground shadow-lg outline-none transition-opacity duration-(--ob-motion-dialog) data-starting-style:opacity-0 data-ending-style:opacity-0", className)}>
        {children}
      </Primitive.Popup>
    </Primitive.Viewport>
  </Primitive.Portal></ToolbarScopeBoundary>;
}
type DialogTitleProps = ComponentProps<"h2">;
function DialogTitle({ className, ...props }: DialogTitleProps) {
  return <Primitive.Title {...props} className={cn("text-base font-semibold", className)} />;
}
type DialogContentProps = DialogPopupProps & { title: string; description?: string };
function DialogContent({ title, description, children, ...props }: DialogContentProps) {
  return <DialogPopup {...props}>
    <div className="grid gap-2 pe-8"><DialogTitle>{title}</DialogTitle>{description ? <Primitive.Description className="text-sm text-ob-muted-foreground">{description}</Primitive.Description> : null}</div>
    {children}
    <Primitive.Close aria-label="关闭" className={cn("absolute end-3 top-3 grid size-8 place-items-center rounded-ob-sm text-ob-muted-foreground hover:bg-ob-accent", controlFocus)}><span aria-hidden="true">×</span></Primitive.Close>
  </DialogPopup>;
}
type DialogFooterProps = ComponentProps<"div">;
function DialogFooter({ className, ...props }: DialogFooterProps) {
  return <div {...props} data-slot="ob-dialog-footer" className={cn("flex flex-wrap justify-end gap-2", className)} />;
}
export { Dialog, DialogTrigger, DialogContent, DialogPopup, DialogTitle, DialogClose, DialogFooter };
export type { DialogProps, DialogTriggerProps, DialogContentProps, DialogPopupProps, DialogTitleProps, DialogCloseProps, DialogFooterProps };
