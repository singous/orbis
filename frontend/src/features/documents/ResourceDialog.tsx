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
  const [submitting,setSubmitting]=useState(false);
  const [submitError,setSubmitError]=useState<string|null>(null);
  const busy=pending||submitting;

  useEffect(() => {
    if (open){setValue(initialValue);setSubmitError(null);}
  }, [initialValue, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = value.trim();
    if (!normalized||busy) return;
    setSubmitting(true);setSubmitError(null);
    try{await onSubmit(normalized);}
    catch(error){setSubmitError(error instanceof Error?error.message:"操作失败，请重试。");}
    finally{setSubmitting(false);}
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen&&!busy) onClose();
      }}
    >
      <DialogContent title={title}>
        <form className="mt-4" onSubmit={handleSubmit}>
          <TextInput
            label={label}
            placeholder={placeholder}
            value={value}
            disabled={busy}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
          />
          {submitError?<p role="alert" className="mt-3 text-sm">{submitError}</p>:null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>取消</Button>
            </DialogClose>
            <Button type="submit" variant="primary" isPending={busy} disabled={!value.trim() || busy}>
              {busy ? "处理中…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
