import { Badge } from "@orbis/ui/badge";
import { Spinner } from "@orbis/ui/spinner";
import { cn } from "@orbis/ui/cn";
import { cardSurfaceClassName } from "../../shared/ui/surface-styles";
import { reportError } from "../../shared/api/request-feedback";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../shared/api/api-client";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { Button } from "@orbis/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@orbis/ui/popover";
import { Maximize2, Minimize2, Tag as TagIcon } from "@orbis/ui/icons";
import { Plus, X } from "../../shared/ui/icons";
import { saveQuickNote, type QuickNote, type QuickNoteTag } from "./api";
import { draftKey, freshDraft, hasNoteContent, pendingWrite, readDraft, removeDraft, writeDraft, type QuickNoteDraft } from "./draft";
import { QuickNoteEditor } from "./QuickNoteEditor";
import { homeCardClassName } from "../home/HomeLayout";

export function QuickNoteComposer({ userId, workspaceId, note, tags, onSaved, onManageTags, canEdit, expanded, onToggleExpanded, appearance = "default" }: {
  userId: string; workspaceId: string; note?: QuickNote; tags: QuickNoteTag[]; onSaved: (note: QuickNote) => void;
  onManageTags: () => void; canEdit: boolean; expanded?: boolean; onToggleExpanded?: () => void; appearance?: "default" | "home" | "dialog";
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
  const tagPicker = <Popover><PopoverTrigger render={<Button variant="outline" size="sm" />} className="quick-note-tag-picker" aria-label="添加标签"><TagIcon aria-hidden="true" />添加标签</PopoverTrigger><PopoverContent className="quick-note-tag-options max-h-64 overflow-y-auto" aria-label="标签选项">
    {tags.filter(tag => !draft.tag_ids.includes(tag.id)).map(tag => <Button key={tag.id} className="h-auto w-full justify-start whitespace-normal" type="button" disabled={locked || draft.tag_ids.length >= 20} onClick={() => update({ ...draft, tag_ids: [...draft.tag_ids, tag.id] })} variant="ghost">{tag.name}</Button>)}
    <Button className="w-full justify-start" type="button" disabled={locked} onClick={onManageTags} variant="ghost"><Plus aria-hidden="true" />管理标签</Button>
  </PopoverContent></Popover>;
  const saveButton = <Button variant="default" className={appearance === "home" ? "ms-auto" : undefined} disabled={(saving) || (!canEdit || !hasContent || uploading)} onClick={() => void submit(conflict)} focusableWhenDisabled={(saving) && !(!canEdit || !hasContent || uploading)} aria-busy={saving || undefined}>{saving ? <Spinner aria-hidden="true" /> : null}{saving ? "正在保存" : conflict ? "将当前内容另存为新记录" : draft.pending ? "重试保存" : note ? "保存修改" : "记一下"}</Button>;
  return <section className={cn("quick-note-composer min-w-0", expanded && "is-expanded", appearance === "home" ? `${homeCardClassName} home-note-composer relative top-auto flex flex-col` : `${cardSurfaceClassName} sticky top-4 [@media(max-width:1100px)]:static`, appearance === "dialog" && "static border-0 shadow-none")} data-home-composer={appearance === "home" || undefined} aria-label={note ? "编辑随手记" : "快速记录"}>
    <header className={appearance === "home" ? "quick-note-composer-heading mb-4 flex items-center justify-between gap-3 p-0 text-sm text-muted-foreground" : cn("quick-note-composer-heading flex items-center justify-between gap-3 px-4 pt-3 text-sm text-(--muted-foreground)", appearance === "dialog" && "hidden")}>{appearance === "home" ? <h2 className="m-0 text-base font-semibold text-foreground">突然想到…</h2> : <span>{note ? "编辑记录" : "快速记录"}</span>}{onToggleExpanded ? <Button size="icon-sm" type="button" title={expanded ? "退出全屏" : "展开编辑区"} aria-label={expanded ? "退出全屏" : "展开编辑区"} onClick={onToggleExpanded} variant="ghost">{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</Button> : null}</header>
    <QuickNoteEditor key={editorKey} initialValue={draft.blocks} disabled={locked} onBusy={setUploading} onError={reportError} onChange={blocks => update({ ...current.current, blocks })} onSubmit={() => void submit(conflict)} expanded={expanded} homeActions={appearance === "home" ? <>{tagPicker}{saveButton}</> : undefined} />
    <div className={appearance === "home" ? "quick-note-composer-tags order-3 flex flex-wrap items-center gap-2 border-0 p-0 [&:not(:empty)]:pt-3" : "quick-note-composer-tags flex flex-wrap items-center gap-2 border-t border-border px-4 py-3"}>
      {draft.tag_ids.map(id => <span className={cn("quick-note-selected-tag inline-flex max-w-full items-center", appearance === "home" && "[&_svg]:size-4")} key={id}><Badge variant="secondary">{tags.find(tag => tag.id === id)?.name ?? "已移除标签"}</Badge><Button size="icon-sm" type="button" disabled={locked} aria-label={`移除标签 ${tags.find(tag => tag.id === id)?.name ?? "已移除标签"}`} onClick={() => update({ ...draft, tag_ids: draft.tag_ids.filter(tag => tag !== id) })} variant="ghost"><X size={12} /></Button></span>)}
      {appearance !== "home" ? tagPicker : null}
    </div>
    {appearance !== "home" ? <footer className="quick-note-composer-footer flex items-center gap-4 px-4 pt-4 pb-2">{saveButton}<span className="quick-note-shortcut text-xs leading-5 text-(--muted-foreground) [@media(max-width:650px)]:hidden">⌘ / Ctrl + Enter</span></footer> : null}
    <div className={cn("quick-note-save-status min-h-[1.6em] text-xs leading-5 text-(--muted-foreground)", appearance === "home" ? "absolute end-4 top-4 m-0 p-0 min-[541px]:end-6 min-[541px]:top-6" : "px-4 pb-4")} aria-live="polite">{saved ? "已记下" : !persisted ? "未保存" : draft.pending ? "未保存" : hasContent ? "未保存" : "仅自己可见"}</div>
    {!canEdit ? <p className="quick-note-hint text-xs leading-5 text-(--muted-foreground)">当前工作空间角色没有编辑权限。</p> : null}

  </section>;
}
