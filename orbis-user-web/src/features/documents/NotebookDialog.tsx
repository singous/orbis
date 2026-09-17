import { type FormEvent, useEffect, useState } from "react";

import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { Button } from "../../shared/ui/Button";
import { Dialog, DialogContent, DialogFooter } from "../../shared/ui/Dialog";
import { TextInput } from "../../shared/ui/TextInput";
import { NotebookIconPicker } from "./NotebookIconPicker";
import { uploadNotebookIcon } from "./notebook-icon-api";
import type { NotebookIconValue } from "./notebook-icons";

export type NotebookDialogValue = { title: string; icon: NotebookIconValue | null };
export type NotebookDialogProps = {
  open: boolean;
  title?: string;
  initialValue?: string;
  initialIcon?: NotebookIconValue | null;
  submitLabel?: string;
  pending?: boolean;
  onClose: () => void;
  onSubmit: (value: NotebookDialogValue) => void | Promise<void>;
};

export function NotebookDialog({ open, title = "新建笔记本", initialValue = "", initialIcon = null, submitLabel = "创建", pending = false, onClose, onSubmit }: NotebookDialogProps) {
  const auth = useOptionalAuthRequest();
  const [value, setValue] = useState(initialValue);
  const [icon, setIcon] = useState<NotebookIconValue | null>(initialIcon);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = pending || submitting || uploading;

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setIcon(initialIcon);
    setError(null);
    setUploading(false);
    setSubmitting(false);
  }, [open, initialValue, initialIcon]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.trim() || busy) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ title: value.trim(), icon });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存笔记本失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !submitting && !pending) onClose(); }}>
    <DialogContent title={title} description="选择一个图标，为你的内容留个专属位置。" className="notebook-dialog">
      <form className="notebook-dialog-form" onSubmit={handleSubmit}>
        <TextInput label="笔记本名称" placeholder="输入笔记本名称" autoFocus value={value} disabled={pending || submitting} onChange={(event) => { setValue(event.target.value); setError(null); }} />
        <NotebookIconPicker value={icon} onChange={setIcon} onPendingChange={setUploading} disabled={pending || submitting} uploadFile={async (file) => {
          if (!auth) throw new Error("登录已失效，请重新登录后上传。");
          return uploadNotebookIcon(file, auth);
        }} />
        {error ? <p className="notebook-icon-error" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" disabled={pending || submitting} onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" disabled={!value.trim() || busy}>{uploading ? "上传中…" : pending || submitting ? "处理中…" : submitLabel}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
