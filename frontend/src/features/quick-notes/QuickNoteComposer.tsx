import { reportError } from "../../shared/api/request-feedback";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../shared/api/api-client";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { Button, buttonVariants } from "../../shared/ui/Button";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Maximize2, Minimize2, Tag as TagIcon } from "@orbis/ui/icons";
import { Plus, X } from "../../shared/ui/icons";
import { Tag } from "../../shared/ui/Tag";
import { saveQuickNote, type QuickNote, type QuickNoteTag } from "./api";
import { draftKey, freshDraft, hasNoteContent, pendingWrite, readDraft, removeDraft, writeDraft, type QuickNoteDraft } from "./draft";
import { QuickNoteEditor } from "./QuickNoteEditor";
import { homeCardClassName } from "../home/HomeLayout";

export function QuickNoteComposer({ userId, workspaceId, note, tags, onSaved, onManageTags, canEdit, expanded, onToggleExpanded, appearance = "default" }: {
  userId: string; workspaceId: string; note?: QuickNote; tags: QuickNoteTag[]; onSaved: (note: QuickNote) => void;
  onManageTags: () => void; canEdit: boolean; expanded?: boolean; onToggleExpanded?: () => void; appearance?: "default" | "home";
}) {
  const auth = useAuthRequest();
  const key = draftKey(userId, workspaceId, note?.id);
  const [draft, setDraft] = useState(() => readDraft(key, freshDraft(note)));
  const current = useRef(draft);
  const [editorKey, setEditorKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [uploading, setUploading] = useState(false);

  const [conflict, setConflict] = useState(false);
  const [persisted, setPersisted] = useState(true);
  const storageFailed = useRef(false);
  const [saved, setSaved] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function update(next: QuickNoteDraft) {
    current.current = next; setDraft(next);
    const stored = writeDraft(key, next);
    if (!stored && !storageFailed.current) reportError("本机草稿保存失败，请保留页面并提交记录");
    storageFailed.current = !stored;
    setPersisted(stored);
    setSaved(value => value && !hasNoteContent(next.blocks) && next.tag_ids.length === 0);
  }
  const locked = !canEdit || saving || Boolean(draft.pending);
  useEffect(() => {
    if (persisted) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [persisted]);

  async function submit(asNew = false) {
    if (saveLock.current || uploading || !canEdit || !hasNoteContent(current.current.blocks)) return;
    saveLock.current = true; setSaving(true);
    const initial = asNew ? { ...current.current, as_new: true, expected_version: 0, pending: null } : current.current;
    const pending = pendingWrite(initial);
    const submitting = { ...initial, pending };
    update(submitting);
    try {
      const result = await saveQuickNote(auth, submitting.as_new ? null : submitting.note_id, pending);
      // Another tab may have newer unsent text under this draft key.
      try { if (localStorage.getItem(key) === JSON.stringify(submitting)) removeDraft(key); } catch { /* A successful server receipt remains recoverable. */ }
      if (!mounted.current) return;
      const next = freshDraft(); current.current = next; setDraft(next); setEditorKey(value => value + 1);
      storageFailed.current = false;
      setPersisted(true); setConflict(false); setSaved(true); onSaved(result);
    } catch (error) {
      if (!mounted.current) return;
      const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
      if (rejected) update({ ...submitting, pending: null });
      setConflict(error instanceof ApiError && ["QUICK_NOTE_VERSION_CONFLICT", "QUICK_NOTE_DELETED"].includes(error.code));
      reportError(error);
    } finally { saveLock.current = false; if (mounted.current) setSaving(false); }
  }
  const hasContent = hasNoteContent(draft.blocks);
  const tagPicker = <details className={appearance === "home" ? "home-note-tag-picker relative" : "quick-note-tag-picker"}><summary className={appearance === "home" ? `${buttonVariants({ variant: "ghost" })} pointer-coarse:min-h-(--ob-control-height-touch)` : undefined} aria-label="添加标签">{appearance === "home" ? <TagIcon aria-hidden="true" /> : <Plus size={14} />}添加标签</summary><div className={appearance === "home" ? "quick-note-tag-options start-auto end-0 max-w-[calc(100vw-3rem)] min-[541px]:start-0 min-[541px]:end-auto min-[541px]:max-w-none" : "quick-note-tag-options"}>
    {tags.filter(tag => !draft.tag_ids.includes(tag.id)).map(tag => <ActionButton key={tag.id} type="button" disabled={locked || draft.tag_ids.length >= 20} onClick={() => update({ ...draft, tag_ids: [...draft.tag_ids, tag.id] })}>{tag.name}</ActionButton>)}
    <ActionButton type="button" disabled={locked} onClick={onManageTags}><Plus size={14} />管理标签</ActionButton>
  </div></details>;
  const saveButton = <Button variant="primary" className={appearance === "home" ? "ms-auto" : undefined} disabled={!canEdit || !hasContent || uploading} isPending={saving} onClick={() => void submit(conflict)}>{saving ? "正在保存" : conflict ? "将当前内容另存为新记录" : draft.pending ? "重试保存" : note ? "保存修改" : "记一下"}</Button>;
  return <section className={`quick-note-composer${expanded ? " is-expanded" : ""}${appearance === "home" ? ` ${homeCardClassName} home-note-composer relative top-auto flex flex-col` : ""}`} data-home-composer={appearance === "home" || undefined} aria-label={note ? "编辑随手记" : "快速记录"}>
    <header className={appearance === "home" ? "quick-note-composer-heading mb-4 flex items-center justify-between gap-3 p-0 text-sm text-ob-muted-foreground" : "quick-note-composer-heading"}>{appearance === "home" ? <h2 className="m-0 text-base font-semibold text-ob-foreground">突然想到…</h2> : <span>{note ? "编辑记录" : "快速记录"}</span>}{onToggleExpanded ? <ActionButton type="button" title={expanded ? "退出全屏" : "展开编辑区"} aria-label={expanded ? "退出全屏" : "展开编辑区"} onClick={onToggleExpanded}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</ActionButton> : null}</header>
    <QuickNoteEditor key={editorKey} initialValue={draft.blocks} disabled={locked} onBusy={setUploading} onError={reportError} onChange={blocks => update({ ...current.current, blocks })} onSubmit={() => void submit(conflict)} homeActions={appearance === "home" ? <>{tagPicker}{saveButton}</> : undefined} />
    <div className={appearance === "home" ? "quick-note-composer-tags order-3 flex flex-wrap items-center gap-2 border-0 p-0 [&:not(:empty)]:pt-3" : "quick-note-composer-tags"}>
      {draft.tag_ids.map(id => <span className={appearance === "home" ? "quick-note-selected-tag [&_svg]:size-4" : "quick-note-selected-tag"} key={id}><Tag>{tags.find(tag => tag.id === id)?.name ?? "已移除标签"}</Tag><ActionButton type="button" disabled={locked} aria-label={`移除标签 ${tags.find(tag => tag.id === id)?.name ?? "已移除标签"}`} onClick={() => update({ ...draft, tag_ids: draft.tag_ids.filter(tag => tag !== id) })}><X size={12} /></ActionButton></span>)}
      {appearance === "default" ? tagPicker : null}
    </div>
    {appearance === "default" ? <footer className="quick-note-composer-footer">{saveButton}<span className="quick-note-shortcut">⌘ / Ctrl + Enter</span></footer> : null}
    <div className={appearance === "home" ? "quick-note-save-status absolute end-4 top-4 m-0 p-0 min-[541px]:end-6 min-[541px]:top-6" : "quick-note-save-status"} aria-live="polite">{saved ? "已记下" : !persisted ? "未保存" : draft.pending ? "未保存" : hasContent ? "未保存" : "仅自己可见"}</div>
    {!canEdit ? <p className="quick-note-hint">当前工作空间角色没有编辑权限。</p> : null}

  </section>;
}
