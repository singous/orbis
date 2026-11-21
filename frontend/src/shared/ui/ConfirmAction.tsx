import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@orbis/ui/alert-dialog";
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

  return <AlertDialog open={open} onOpenChange={(value, details) => {
    if (running.current) { details.cancel(); return; }
    setOpen(value);
  }}>
    <AlertDialogTrigger render={children} disabled={disabled} />
    <AlertDialogContent initialFocus={cancel}>
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel ref={cancel} disabled={pending} render={<Button variant="outline" />}>取消</AlertDialogCancel>
        <Button variant="destructive" disabled={disabled || pending} focusableWhenDisabled={pending && !disabled} aria-busy={pending || undefined} onClick={() => void confirm()}>{pending ? <Spinner aria-hidden="true" /> : null}{confirmLabel}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
