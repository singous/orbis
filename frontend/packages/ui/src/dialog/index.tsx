import { Dialog as Primitive } from "@base-ui/react/dialog";
import { createContext, useContext, useState, type ComponentProps, type CSSProperties, type RefObject, type ReactElement, type ReactNode } from "react";
import { cn } from "../cn";
import { resolveClassName } from "../internal/resolve-class-name";
import { controlFocus } from "../internal/focus";
import { usePortalTheme } from "../internal/use-portal-theme";

type DialogProps = { children: ReactNode } & (
  | { open: boolean; onOpenChange: (open: boolean) => void; defaultOpen?: never }
  | { open?: never; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }
);
const ThemeContext = createContext<{ theme: "light" | "dark"; portalStyle: CSSProperties }>({ theme: "light", portalStyle: {} });
function Dialog({ children, onOpenChange, ...props }: DialogProps) {
  const [openingElement, setOpeningElement] = useState<Element | null>(null);
  const { anchor, theme, portalStyle } = usePortalTheme(openingElement);
  return <ThemeContext.Provider value={{ theme, portalStyle }}><span hidden ref={anchor} /><Primitive.Root {...props} onOpenChange={(open, details) => {
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
type DialogContentProps = Omit<ComponentProps<"div">, "className" | "style"> & {
  title: string;
  description?: string;
  initialFocus?: boolean | RefObject<HTMLElement | null>;
  finalFocus?: boolean | RefObject<HTMLElement | null>;
  className?: string | ((state: DialogContentState) => string | undefined);
  style?: CSSProperties | ((state: DialogContentState) => CSSProperties | undefined);
};
function DialogContent({ title, description, className, children, ...props }: DialogContentProps) {
  const { theme, portalStyle } = useContext(ThemeContext);
  return <Primitive.Portal data-theme={theme} style={portalStyle}>
    <Primitive.Backdrop data-slot="ob-dialog-backdrop" className="fixed inset-0 z-(--ob-z-dialog) bg-(--ob-scrim) transition-opacity duration-(--ob-motion-dialog) data-starting-style:opacity-0 data-ending-style:opacity-0" />
    <Primitive.Viewport className="fixed inset-0 z-(--ob-z-dialog) grid items-center justify-items-center overflow-y-auto p-4">
      <Primitive.Popup {...props} data-slot="ob-dialog" className={resolveClassName("relative grid w-full max-w-lg gap-5 rounded-ob-xl border border-ob-border bg-ob-card p-6 text-ob-foreground shadow-lg outline-none transition-opacity duration-(--ob-motion-dialog) data-starting-style:opacity-0 data-ending-style:opacity-0", className)}>
        <div className="grid gap-2 pe-8"><Primitive.Title className="text-base font-semibold">{title}</Primitive.Title>{description ? <Primitive.Description className="text-sm text-ob-muted-foreground">{description}</Primitive.Description> : null}</div>
        {children}
        <Primitive.Close aria-label="关闭" className={cn("absolute end-3 top-3 grid size-8 place-items-center rounded-ob-sm text-ob-muted-foreground hover:bg-ob-accent", controlFocus)}><span aria-hidden="true">×</span></Primitive.Close>
      </Primitive.Popup>
    </Primitive.Viewport>
  </Primitive.Portal>;
}
type DialogFooterProps = ComponentProps<"div">;
function DialogFooter({ className, ...props }: DialogFooterProps) {
  return <div {...props} data-slot="ob-dialog-footer" className={cn("flex flex-wrap justify-end gap-2", className)} />;
}
export { Dialog, DialogTrigger, DialogContent, DialogClose, DialogFooter };
export type { DialogProps, DialogTriggerProps, DialogContentProps, DialogCloseProps, DialogFooterProps };
