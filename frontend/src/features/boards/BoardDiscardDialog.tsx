import { Dialog, DialogPopup, DialogTitle, DialogFooter } from "@orbis/ui/dialog";
import { useId, useRef } from "react";
import { Button } from "../../shared/ui/Button";

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
  return <Dialog dismissOnOutsidePress={false} open={open} onOpenChange={value => { if (!value) onCancel(); }}>
    <DialogPopup role="alertdialog" initialFocus={cancel} aria-describedby={descriptionId} className="max-w-112">
      <DialogTitle>画板尚未保存</DialogTitle><p id={descriptionId} className="text-sm leading-6 text-ob-muted-foreground">{description}</p>
      <DialogFooter>
        <Button ref={cancel} onPress={onCancel}>{cancelLabel}</Button>
        <Button variant="danger" disabled={disabled} onPress={onDiscard}>{discardLabel}</Button>
      </DialogFooter>
    </DialogPopup>
  </Dialog>;
}
