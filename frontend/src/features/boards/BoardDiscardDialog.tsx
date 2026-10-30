import { AlertDialog } from "@heroui/react/alert-dialog";
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
  return <AlertDialog isOpen={open} onOpenChange={value => { if (!value) onCancel(); }}>
    <AlertDialog.Backdrop>
      <AlertDialog.Container>
        <AlertDialog.Dialog>
          <AlertDialog.Header>
            <AlertDialog.Icon status="warning" />
            <AlertDialog.Heading>画板尚未保存</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body><p>{description}</p></AlertDialog.Body>
          <AlertDialog.Footer>
            <Button autoFocus onPress={onCancel}>{cancelLabel}</Button>
            <Button variant="danger" disabled={disabled} onPress={onDiscard}>{discardLabel}</Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  </AlertDialog>;
}
