import { type FormEvent, useEffect, useState } from "react";
import { X } from "lucide-react";

import { Button } from "../../shared/ui/Button";
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

  if (!open) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = value.trim();
    if (!normalized) return;
    await onSubmit(normalized);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-5 shadow-2xl"
        onSubmit={handleSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
          <button type="button" aria-label="关闭" className="icon-button" onClick={onClose}>
            <X aria-hidden="true" size={17} />
          </button>
        </div>
        <TextInput label={label} placeholder={placeholder} value={value} autoFocus onChange={(event) => setValue(event.target.value)} />
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" disabled={!value.trim() || pending}>{pending ? "处理中…" : submitLabel}</Button>
        </div>
      </form>
    </div>
  );
}
