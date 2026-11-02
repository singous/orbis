import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogHeader, DialogFooter } from "@orbis/ui/dialog";
import { useRef, useState, type ReactElement } from "react";
import { reportError } from "../api/request-feedback";
import { Button } from "@orbis/ui/button";
import { Spinner } from "@orbis/ui/spinner";

/** 危险操作只在用户明确确认后执行；请求失败仍由统一反馈出口处理。 */
export function ConfirmAction({ children, title, description, confirmLabel, onConfirm, disabled = false }: {
  children: ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);

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

  return <Dialog disablePointerDismissal open={open} onOpenChange={(value, details) => {
    if (running.current) { details.cancel(); return; }
    setOpen(value);
  }}>
    <DialogTrigger render={children} disabled={disabled} />
    <DialogContent role="alertdialog" initialFocus={cancel} showCloseButton={false}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <DialogFooter>
        <Button ref={cancel} disabled={pending} onClick={() => setOpen(false)}>取消</Button>
        <Button variant="destructive" disabled={disabled || pending} focusableWhenDisabled={pending && !disabled} aria-busy={pending || undefined} onClick={() => void confirm()}>{pending ? <Spinner aria-hidden="true" /> : null}{confirmLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
