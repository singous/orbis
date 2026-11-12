import { Dialog, DialogContent, DialogTitle, DialogFooter } from "@orbis/ui/dialog";
import { useId, useRef } from "react";
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
  const descriptionId = useId();
  return <Dialog  open={open} onOpenChange={value => { if (!value) onCancel(); }} disablePointerDismissal>
    <DialogContent role="alertdialog" initialFocus={cancel} aria-describedby={descriptionId} showCloseButton={false}>
      <DialogTitle>画板尚未保存</DialogTitle><p id={descriptionId} className="text-sm leading-6 text-muted-foreground">{description}</p>
      <DialogFooter>
        <Button ref={cancel} onClick={event => { event.stopPropagation(); onCancel(); }}>{cancelLabel}</Button>
        <Button variant="destructive" disabled={disabled} onClick={event => { event.stopPropagation(); onDiscard(); }}>{discardLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
