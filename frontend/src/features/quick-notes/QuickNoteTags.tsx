import { Input } from "@orbis/ui/input";
import { Spinner } from "@orbis/ui/spinner";
import { reportError } from "../../shared/api/request-feedback";
import { newUUID } from "../../shared/ids";
import { useRef, useState } from "react";
import { ApiError } from "../../shared/api/api-client";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { Button } from "@orbis/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@orbis/ui/dialog";
import { Pencil, Trash2, X } from "../../shared/ui/icons";
import { writeQuickNoteTag, type QuickNoteTag } from "./api";

type PendingTag = { id: string | null; remove: boolean; body: { operation_id: string; expected_version: number; name?: string } };
export function QuickNoteTags({ open, onOpenChange, tags, onChanged }: { open: boolean; onOpenChange: (open: boolean) => void; tags: QuickNoteTag[]; onChanged: () => void }) {
  const auth = useAuthRequest();
  const [editing, setEditing] = useState<QuickNoteTag | null>(null);
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<QuickNoteTag | null>(null);
  const [pending, setPending] = useState<PendingTag | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  async function save(remove = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    const target = remove ? removing : editing;
    const action = pending ?? { id: target?.id ?? null, remove, body: { operation_id: newUUID(), expected_version: target?.version ?? 0, ...(remove ? {} : { name: name.trim() }) } };
    setPending(action);
    try { await writeQuickNoteTag(auth, action.id, action.body, action.remove); setPending(null); setEditing(null); setRemoving(null); setName(""); onChanged(); }
    catch (error) { reportError(error); if (error instanceof ApiError && error.status < 500 && ![408, 429].includes(error.status)) setPending(null); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(next, details) => { if (!next && busy) { details.cancel(); return; } onOpenChange(next); }}><DialogContent><DialogHeader><DialogTitle>{"管理标签"}</DialogTitle><DialogDescription>{"标签仅自己可见。删除标签会解除关联，记录会保留。"}</DialogDescription></DialogHeader>
    <form className="quick-note-tag-form mb-4 flex flex-wrap items-end gap-2 [&>label]:min-w-[180px] [&>label]:flex-1" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="grid gap-2 text-sm font-medium"><span>{editing ? "标签新名称" : "新标签名称"}</span><Input maxLength={40} value={name} disabled={busy || Boolean(pending)} onChange={event => setName(event.target.value)} placeholder="例如：灵感、工作记录" /></label>
      <Button type="submit" variant="default" disabled={(busy) || (!name.trim() || Boolean(removing) || Boolean(pending))} focusableWhenDisabled={(busy) && !(!name.trim() || Boolean(removing) || Boolean(pending))} aria-busy={busy || undefined}>{busy ? <Spinner aria-hidden="true" /> : null} {editing ? "保存名称" : "添加标签"}</Button>
      {editing && !pending ? <Button type="button" size="icon-sm" aria-label="取消重命名" onClick={() => { setEditing(null); setName(""); }} variant="ghost"><X size={16} /></Button> : null}
    </form>
    {pending && !busy ? <Button onClick={() => void save()} variant="outline">重试标签操作</Button> : null}

    <div className="quick-note-tag-list max-h-[350px] overflow-auto">{tags.length ? tags.map(tag => <div className="quick-note-tag-row flex items-center gap-2 border-b border-border py-2" key={tag.id}><span className="min-w-0 flex-1 wrap-anywhere">{tag.name}<small className="block text-(--muted-foreground)">{tag.count} 条记录</small></span><Button size="icon-sm" type="button" aria-label={`重命名标签 ${tag.name}`} disabled={busy || Boolean(pending)} onClick={() => { setEditing(tag); setName(tag.name); setRemoving(null); }} variant="ghost"><Pencil size={15} /></Button><Button size="icon-sm" type="button" aria-label={`删除标签 ${tag.name}`} disabled={busy || Boolean(pending)} onClick={() => setRemoving(tag)} variant="ghost"><Trash2 size={15} /></Button></div>) : <p className="quick-note-hint text-xs leading-5 text-(--muted-foreground)">添加第一个标签，方便以后找到记录。</p>}</div>
    {removing ? <div className="quick-note-tag-confirm mt-4 [&>button]:me-2"><p>删除“{removing.name}”标签？已有记录会保留。</p><Button variant="destructive" disabled={(busy) || (Boolean(pending))} onClick={() => void save(true)} focusableWhenDisabled={(busy) && !(Boolean(pending))} aria-busy={busy || undefined}>{busy ? <Spinner aria-hidden="true" /> : null}确认删除标签</Button><Button disabled={busy || Boolean(pending)} onClick={() => setRemoving(null)} variant="outline">取消</Button></div> : null}
  </DialogContent></Dialog>;
}
