import { Spinner } from "@orbis/ui/spinner";
import { reportError } from "../../shared/api/request-feedback";
import { type ComponentProps, type FormEvent, useEffect, useRef, useState } from "react";

import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { Button } from "@orbis/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@orbis/ui/dialog";
import { Input } from "@orbis/ui/input";
import { NotebookIconPicker } from "./NotebookIconPicker";
import { uploadNotebookIcon } from "./notebook-icon-api";
import type { NotebookIconValue } from "./notebook-icons";
import type { Notebook } from "../../shared/api/schemas";
import { useUpdateNotebook } from "./queries";

export type NotebookDialogValue = { title: string; icon: NotebookIconValue | null };
export type NotebookDialogProps = {
  open: boolean;
  title?: string;
  initialValue?: string;
  initialIcon?: NotebookIconValue | null;
  submitLabel?: string;
  pending?: boolean;
  finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"];
  onClose: () => void;
  onSubmit: (value: NotebookDialogValue) => void | Promise<void>;
};

export function NotebookDialog({ open, title = "新建笔记本", initialValue = "", initialIcon = null, submitLabel = "创建", pending = false, finalFocus, onClose, onSubmit }: NotebookDialogProps) {
  const auth = useOptionalAuthRequest();
  const nameInput = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const [icon, setIcon] = useState<NotebookIconValue | null>(initialIcon);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const busy = pending || submitting || uploading;

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setIcon(initialIcon);
    setUploading(false);
    setSubmitting(false);
  }, [open, initialValue, initialIcon]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.trim() || busy) return;
    setSubmitting(true);
    try {
      await onSubmit({ title: value.trim(), icon });
    } catch (submitError) {
      reportError(submitError);
    } finally {
      setSubmitting(false);
    }
  }

  return <Dialog open={open}  onOpenChange={(nextOpen, details) => { if (!nextOpen && (submitting || pending)) { details.cancel(); return; } if (!nextOpen) onClose(); }} disablePointerDismissal={submitting || pending}>
    <DialogContent showCloseButton={!submitting && !pending} className="notebook-dialog max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain" initialFocus={pending || submitting ? true : nameInput} finalFocus={finalFocus}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{"选择一个图标，为你的内容留个专属位置。"}</DialogDescription></DialogHeader>
      <form className="notebook-dialog-form grid gap-4" onSubmit={handleSubmit}>
        <label className="grid gap-2 text-sm font-medium"><span>{"笔记本名称"}</span><Input ref={nameInput} placeholder="输入笔记本名称" value={value} disabled={pending || submitting} onChange={(event) => setValue(event.target.value)} /></label>
        <NotebookIconPicker value={icon} onChange={setIcon} onPendingChange={setUploading} disabled={pending || submitting} uploadFile={async (file) => {
          if (!auth) throw new Error("登录已失效，请重新登录后上传。");
          return uploadNotebookIcon(file, auth);
        }} />
        <DialogFooter>
          <Button variant="ghost" disabled={pending || submitting} onClick={onClose}>取消</Button>
          <Button type="submit" variant="default"  disabled={!value.trim() || busy} aria-busy={busy || undefined}>{busy ? <Spinner aria-hidden="true" /> : null}{uploading ? "上传中…" : pending || submitting ? "处理中…" : submitLabel}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function EditNotebookDialog({ notebook, onClose, finalFocus }: { notebook: Notebook; onClose: () => void; finalFocus?: NotebookDialogProps["finalFocus"] }) {
  const update = useUpdateNotebook();
  return <NotebookDialog open title="编辑笔记本" initialValue={notebook.title} initialIcon={notebook.icon} submitLabel="保存" pending={update.isPending} finalFocus={finalFocus} onClose={onClose} onSubmit={async ({ title, icon }) => {
    await update.mutateAsync({ id: notebook.id, expected_version: notebook.metadata_version, title, icon });
    onClose();
  }} />;
}
