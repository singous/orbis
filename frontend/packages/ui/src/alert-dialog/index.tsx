import { AlertDialog as Primitive } from "@base-ui/react/alert-dialog";
import type { ComponentProps } from "react";
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../dialog";
import { cn } from "../cn";

const AlertDialog = Primitive.Root;
const AlertDialogTrigger = Primitive.Trigger;
const AlertDialogCancel = Primitive.Close;

// Base UI 的 AlertDialog 与 Dialog 共享 Popup、Portal 和标题上下文。
function AlertDialogContent({ className, ...props }: Primitive.Popup.Props) {
  return <DialogContent {...props} showCloseButton={false} className={cn("rounded-2xl shadow-lg", className)} />;
}

function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <DialogFooter {...props} className={cn("rounded-b-2xl", className)} />;
}

export {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogTrigger,
  DialogDescription as AlertDialogDescription, DialogHeader as AlertDialogHeader, DialogTitle as AlertDialogTitle,
};
