import { AlertDialog } from "@heroui/react/alert-dialog";
import { useRef, useState, type ReactNode } from "react";
import { reportError } from "../api/request-feedback";
import { Button } from "./Button";

/** 危险操作只在用户明确确认后执行；请求失败仍由统一反馈出口处理。 */
export function ConfirmAction({ children, title, description, confirmLabel, onConfirm, disabled = false }: {
  children: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const running = useRef(false);

  async function confirm() {
    if (running.current || disabled) return;
    running.current = true;
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch (error) {
      reportError(error);
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <AlertDialog isOpen={open} onOpenChange={value => { if (!running.current) setOpen(value); }}>
      {children}
      <AlertDialog.Backdrop isKeyboardDismissDisabled={pending}>
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning" />
              <AlertDialog.Heading>{title}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body><p>{description}</p></AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" autoFocus disabled={pending}>取消</Button>
              <Button variant="danger" disabled={disabled} isPending={pending} onPress={() => void confirm()}>{confirmLabel}</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
