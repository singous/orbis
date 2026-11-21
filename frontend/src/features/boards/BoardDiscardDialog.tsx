import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@orbis/ui/alert-dialog";
import { useRef } from "react";
import { Button } from "@orbis/ui/button";

export function BoardDiscardDialog({ open, description, cancelLabel, discardLabel, onCancel, onDiscard, disabled = false }: {
  open: boolean;
  description: string;
  cancelLabel: string;
  discardLabel: string;
  onCancel: () => void;
  onDiscard: () => void;
  disabled?: boolean;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  return <AlertDialog open={open} onOpenChange={value => { if (!value) onCancel(); }}>
    <AlertDialogContent initialFocus={cancel}>
      <AlertDialogTitle>画板尚未保存</AlertDialogTitle><AlertDialogDescription className="leading-6">{description}</AlertDialogDescription>
      <AlertDialogFooter>
        <Button ref={cancel} onClick={event => { event.stopPropagation(); onCancel(); }}>{cancelLabel}</Button>
        <Button variant="destructive" disabled={disabled} onClick={event => { event.stopPropagation(); onDiscard(); }}>{discardLabel}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
