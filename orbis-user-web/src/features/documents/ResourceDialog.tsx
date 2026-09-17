import { type FormEvent, useEffect, useState } from "react";

import { Button } from "../../shared/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "../../shared/ui/Dialog";
import { TextInput } from "../../shared/ui/TextInput";

export function ResourceDialog({
  open,
  title,
  label,
  placeholder,
  initialValue = "",
  submitLabel = "创建",
  pending = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  placeholder: string;
  initialValue?: string;
  submitLabel?: string;
  pending?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [initialValue, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = value.trim();
    if (!normalized) return;
    await onSubmit(normalized);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent title={title}>
        <form className="mt-4" onSubmit={handleSubmit}>
          <TextInput
            label={label}
            placeholder={placeholder}
            value={value}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">取消</Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={!value.trim() || pending}>
              {pending ? "处理中…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
