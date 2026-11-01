import { Dialog, DialogTrigger, DialogPopup, DialogTitle, DialogFooter } from "@orbis/ui/dialog";
import { useId, useRef, useState, type ReactElement } from "react";
import { reportError } from "../api/request-feedback";
import { Button } from "./Button";

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
  const descriptionId = useId();

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

  return <Dialog dismissible={!pending} dismissOnOutsidePress={false} open={open} onOpenChange={value => { if (!running.current) setOpen(value); }}>
    <DialogTrigger asChild>{children}</DialogTrigger>
    <DialogPopup role="alertdialog" initialFocus={cancel} aria-describedby={descriptionId} className="max-w-112">
      <DialogTitle>{title}</DialogTitle><p id={descriptionId} className="text-sm leading-6 text-ob-muted-foreground">{description}</p>
      <DialogFooter>
        <Button ref={cancel} disabled={pending} onClick={() => setOpen(false)}>取消</Button>
        <Button variant="danger" disabled={disabled} isPending={pending} onPress={() => void confirm()}>{confirmLabel}</Button>
      </DialogFooter>
    </DialogPopup>
  </Dialog>;
}
