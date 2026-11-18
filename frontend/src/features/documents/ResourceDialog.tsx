import { Spinner } from "@orbis/ui/spinner";
import { reportError } from "../../shared/api/request-feedback";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { Button } from "@orbis/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@orbis/ui/dialog";
import { Input } from "@orbis/ui/input";

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
  const valueInput = useRef<HTMLInputElement>(null);

  const busy=pending||submitting;

  useEffect(() => {
    if (open){setValue(initialValue);}
  }, [initialValue, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = value.trim();
    if (!normalized||busy) return;
    setSubmitting(true);
    try{await onSubmit(normalized);}
    catch(error){ reportError(error);}
    finally{setSubmitting(false);}
  }

  return (
    <Dialog
      open={open}

      onOpenChange={(nextOpen, details) => { if (!nextOpen && busy) { details.cancel(); return; }
        if (!nextOpen&&!busy) onClose();
       }} disablePointerDismissal={busy}
    >
      <DialogContent showCloseButton={!busy} initialFocus={busy ? true : valueInput}><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-2 text-sm font-medium"><span>{label}</span><Input placeholder={placeholder} value={value} disabled={busy} ref={valueInput} onChange={(event) => setValue(event.target.value)} /></label>

          <DialogFooter>
            <DialogClose render={<Button variant="ghost" disabled={busy}>取消</Button>} />
            <Button type="submit" variant="default"  disabled={!value.trim() || busy} aria-busy={busy || undefined}>{busy ? <Spinner aria-hidden="true" /> : null}
              {busy ? "处理中…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
