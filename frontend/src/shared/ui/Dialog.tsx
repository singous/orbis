import { Dialog as PrimitiveDialog, DialogTrigger as PrimitiveTrigger, DialogClose as PrimitiveClose, DialogPopup, DialogTitle, DialogFooter as PrimitiveFooter } from "@orbis/ui/dialog";
import { Children, isValidElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { cn } from "./cn";
import { X } from "./icons";
import { Button } from "@orbis/ui/button";

type DialogProps = { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; dismissible?: boolean; children: ReactNode };
export function Dialog({ open, defaultOpen, onOpenChange, dismissible, children }: DialogProps) {
  const content = Children.map(children, (child, index) => {
    // 兼容既有 DraftActions 的首个直接按钮；显式触发器和受控弹窗不作转换。
    if (open === undefined && index === 0 && isValidElement(child) && child.type !== DialogContent && child.type !== DialogTrigger) return <PrimitiveTrigger asChild>{child}</PrimitiveTrigger>;
    return child;
  });
  return open === undefined
    ? <PrimitiveDialog defaultOpen={defaultOpen} onOpenChange={onOpenChange} dismissible={dismissible}>{content}</PrimitiveDialog>
    : <PrimitiveDialog open={open} onOpenChange={value => onOpenChange?.(value)} dismissible={dismissible}>{content}</PrimitiveDialog>;
}
export function DialogTrigger({ children }: { asChild?: boolean; children: ReactElement }) { return <PrimitiveTrigger asChild>{children}</PrimitiveTrigger>; }
export function DialogClose({ children }: { asChild?: boolean; children: ReactElement }) { return <PrimitiveClose asChild>{children}</PrimitiveClose>; }
export function DialogContent({ title, description, className, children, hideCloseButton = false, initialFocus, finalFocus }: { title: string; description?: string; className?: string; children?: ReactNode; hideCloseButton?: boolean; initialFocus?: ComponentProps<typeof DialogPopup>["initialFocus"]; finalFocus?: ComponentProps<typeof DialogPopup>["finalFocus"] }) {
  const descriptionId = useId();
  return <DialogPopup aria-describedby={description ? descriptionId : undefined} initialFocus={initialFocus} finalFocus={finalFocus} className={cn("max-w-112 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain p-[clamp(20px,4vw,28px)]", className)}>
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
      <DialogTitle className="min-w-0 wrap-anywhere font-semibold tracking-tight">{title}</DialogTitle>
      {hideCloseButton ? null : <PrimitiveClose asChild><Button appearance="unstyled" aria-label="关闭" className="col-start-2 row-start-1 grid size-8 place-items-center rounded-ob-sm text-ob-muted-foreground hover:bg-ob-accent hover:text-ob-foreground"><X aria-hidden="true" size={14} /></Button></PrimitiveClose>}
      {description ? <p id={descriptionId} className="col-span-full min-w-0 text-sm leading-6 wrap-anywhere text-ob-muted-foreground">{description}</p> : null}
    </header>
    {children}
  </DialogPopup>;
}
export function DialogFooter({ className, ...props }: { className?: string; children?: ReactNode }) { return <PrimitiveFooter {...props} className={cn("mt-6", className)} />; }
