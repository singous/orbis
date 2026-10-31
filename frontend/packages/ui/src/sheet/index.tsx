import { Dialog as Sheet, DialogTrigger as SheetTrigger, DialogClose as SheetClose, DialogTitle as SheetTitle, DialogPopup } from "../dialog";
import type { DialogProps as SheetProps, DialogTriggerProps as SheetTriggerProps, DialogCloseProps as SheetCloseProps, DialogTitleProps as SheetTitleProps } from "../dialog";
import type { ComponentProps } from "react";
import { resolveClassName } from "../internal/resolve-class-name";
import { cn } from "../cn";
type SheetContentProps = ComponentProps<typeof DialogPopup>;
function SheetContent({ className, viewportClassName, ...props }: SheetContentProps) {
  return <DialogPopup {...props} viewportClassName={cn("flex items-stretch justify-end p-0", viewportClassName)} className={resolveClassName("h-dvh max-h-none w-full max-w-130 rounded-none border-y-0 border-e-0 p-0", className)} />;
}
export { Sheet, SheetTrigger, SheetClose, SheetTitle, SheetContent };
export type { SheetProps, SheetTriggerProps, SheetCloseProps, SheetTitleProps, SheetContentProps };
