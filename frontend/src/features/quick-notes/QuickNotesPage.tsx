import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { StickyNote, Tags, LayoutGrid, List, Search } from "lucide-react";
import { authStore, getAuthSessionKey } from "../../shared/auth/auth-store";
import { useAuthRequest } from "../../shared/auth/use-auth-request";
import { ApiError } from "../../shared/api/api-client";
import { Button } from "../../shared/ui/Button";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { TextInput } from "../../shared/ui/TextInput";
import { SelectField } from "../../shared/ui/SelectField";
import { Tag } from "../../shared/ui/Tag";
import { ChevronDown, Pencil, Pin, Trash2, ArchiveRestore } from "../../shared/ui/icons";
import { LoadingState } from "../../shared/ui/LoadingState";
import { DocumentShell } from "../documents/DocumentShell";
import { ContentRenderer } from "../content/ContentRenderer";
import { FileContentContext } from "../files/FileContent";
import { useManagedFiles } from "../files/use-managed-files";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { listQuickNotes, listQuickNoteTags, patchQuickNote, quickNoteSummary, type NoteFilter, type QuickNote, type QuickNoteTag } from "./api";
import { editorBlocks } from "./QuickNoteEditor";
import { QuickNoteComposer } from "./QuickNoteComposer";
import { QuickNoteTags } from "./QuickNoteTags";
import "./quick-notes.css";

const noteTime = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

function NoteCard({ note, tags, canEdit, disabled, onEdit, onPatch }: { note: QuickNote; tags: QuickNoteTag[]; canEdit: boolean; disabled: boolean; onEdit: () => void; onPatch: (change: { is_pinned?: boolean; is_deleted?: boolean }) => void }) {
  const [expanded, setExpanded] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const element = content.current; if (!element) return;
    const measure = () => setOverflow(element.scrollHeight > 320);
      measure(); const observer = new ResizeObserver(measure); observer.observe(element); if (element.firstElementChild) observer.observe(element.firstElementChild); return () => observer.disconnect();
  }, [note.blocks]);
  return <article className={`quick-note-card${note.is_pinned ? " is-pinned" : ""}`} aria-label="随手记记录">
    <header className="quick-note-card-heading"><time dateTime={new Date(note.updated_at_ms).toISOString()}>更新于 {noteTime.format(note.updated_at_ms)}</time>{note.is_pinned ? <Pin aria-label="已置顶" size={14} /> : null}
      {canEdit ? <div className="quick-note-card-actions">{note.deleted_at_ms !== null ? <ActionButton type="button" disabled={disabled} aria-label="恢复记录" title="恢复记录" onClick={() => onPatch({ is_deleted: false })}><ArchiveRestore size={15} /></ActionButton> : <><ActionButton type="button" disabled={disabled} aria-label="编辑记录" title="编辑记录" onClick={onEdit}><Pencil size={15} /></ActionButton><ActionButton type="button" disabled={disabled} aria-label={note.is_pinned ? "取消置顶" : "置顶记录"} title={note.is_pinned ? "取消置顶" : "置顶记录"} onClick={() => onPatch({ is_pinned: !note.is_pinned })}><Pin size={15} /></ActionButton><ActionButton type="button" disabled={disabled} aria-label="移入回收站" title="移入回收站" onClick={() => onPatch({ is_deleted: true })}><Trash2 size={15} /></ActionButton></>}</div> : null}
    </header>
    <div className={`quick-note-card-content${expanded ? " is-expanded" : ""}`} ref={content}><ContentRenderer blocks={editorBlocks(note.blocks)} /></div>
    <footer className="quick-note-card-footer"><div className="quick-note-card-tags">{note.tag_ids.map(id => <Tag key={id}>{tags.find(tag => tag.id === id)?.name ?? "标签"}</Tag>)}</div>{overflow || expanded ? <ActionButton type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><ChevronDown size={14} />{expanded ? "收起" : "展开"}</ActionButton> : null}</footer>
  </article>;
}

type PendingPatch = { id: string; body: { operation_id: string; expected_version: number; is_pinned?: boolean; is_deleted?: boolean } };
function QuickNotesWorkspace() {
  const auth = useAuthRequest();
  const sessionKey = useStore(authStore, getAuthSessionKey);
  const user = useStore(authStore, state => state.user)!;
  const workspace = useStore(authStore, state => state.workspace)!;
  const canEdit = canMutateWorkspaceContent(workspace);
  const files = useManagedFiles("/quick-note-assets");
  const queryClient = useQueryClient();
  const prefix = ["quick-notes", sessionKey];
  const [filter, setFilter] = useState<NoteFilter>({ q: "", tag: "", sort: "updated", deleted: false });
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "cards">("list");
  const [tagManager, setTagManager] = useState(false);
  const [editing, setEditing] = useState<QuickNote | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [patch, setPatch] = useState<PendingPatch | null>(null);
  const [patching, setPatching] = useState(false);
  const patchLock = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { const timer = setTimeout(() => setFilter(value => ({ ...value, q: search })), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { if (!expanded) return; const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [expanded]);
  const notes = useInfiniteQuery({ queryKey: [...prefix, "list", filter], queryFn: ({ pageParam, signal }) => listQuickNotes(auth, filter, pageParam, signal), initialPageParam: 1, getNextPageParam: last => last.pagination.page * last.pagination.page_size < last.pagination.total ? last.pagination.page + 1 : undefined });
  const tags = useQuery({ queryKey: [...prefix, "tags"], queryFn: ({ signal }) => listQuickNoteTags(auth, signal) });
  const summary = useQuery({ queryKey: [...prefix, "summary"], queryFn: ({ signal }) => quickNoteSummary(auth, signal) });
  const tagItems = tags.data?.items ?? [];
  const items = [...new Map((notes.data?.pages.flatMap(page => page.items) ?? []).map(note => [note.id, note])).values()];
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: prefix }); };
  async function runPatch(next: PendingPatch) {
    if (patchLock.current) return;
    patchLock.current = true; setPatch(next); setPatching(true); setError("");
    try { await patchQuickNote(auth, next.id, next.body); setPatch(null); setMessage(next.body.is_deleted === true ? "已移入回收站，可随时恢复" : next.body.is_deleted === false ? "记录已恢复" : "置顶状态已更新"); refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "操作失败，请重试"); if (error instanceof ApiError && error.status < 500 && ![408, 429].includes(error.status)) { setPatch(null); refresh(); } }
    finally { patchLock.current = false; setPatching(false); }
  }
  function chooseTag(tag: string) { setFilter(value => ({ ...value, tag })); }
  return <DocumentShell>
    <div className={`quick-notes-page${expanded ? " composer-expanded" : ""}`}>
      <header className="quick-notes-heading"><div><h1>随手记</h1><span>把零散的想法，留在这里</span></div><div className="quick-notes-view" role="group" aria-label="记录展示方式"><ActionButton type="button" title="列表视图" aria-label="列表视图" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={17} /></ActionButton><ActionButton type="button" title="卡片视图" aria-label="卡片视图" aria-pressed={view === "cards"} onClick={() => setView("cards")}><LayoutGrid size={17} /></ActionButton></div></header>
      <div className="quick-notes-layout">
        <QuickNoteComposer userId={user.id} workspaceId={workspace.id} tags={tagItems} canEdit={canEdit} expanded={expanded} onToggleExpanded={() => setExpanded(value => !value)} onManageTags={() => setTagManager(true)} onSaved={() => { refresh(); setFilter(value => ({ ...value, q: "", tag: "", deleted: false })); setSearch(""); }} />
        <section className="quick-notes-feed" aria-label="历史记录">
          <div className="quick-notes-filters"><div className="quick-notes-search"><Search size={16} aria-hidden="true" /><TextInput aria-label="搜索随手记" placeholder="搜索记录…" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></div><SelectField aria-label="记录排序" density="compact" value={filter.sort} options={[{ value: "updated", label: "最近更新" }, { value: "created", label: "最近创建" }]} onChange={value => setFilter(current => ({ ...current, sort: value as NoteFilter["sort"] }))} /><ActionButton type="button" aria-label={filter.deleted ? "返回全部记录" : "查看回收站"} title={filter.deleted ? "返回全部记录" : "查看回收站"} aria-pressed={filter.deleted} onClick={() => setFilter(current => ({ ...current, deleted: !current.deleted, tag: "" }))}><Trash2 size={17} /></ActionButton></div>
          <div className="quick-notes-tag-filters" aria-label="按标签筛选"><ActionButton type="button" aria-pressed={!filter.tag} onClick={() => chooseTag("")}>{filter.deleted ? "回收站" : "全部"} {summary.data ? `(${filter.deleted ? summary.data.deleted : summary.data.total})` : ""}</ActionButton>{!filter.deleted ? <><ActionButton type="button" aria-pressed={filter.tag === "untagged"} onClick={() => chooseTag("untagged")}>无标签 {summary.data ? `(${summary.data.untagged})` : ""}</ActionButton>{tagItems.map(tag => <ActionButton key={tag.id} type="button" aria-pressed={filter.tag === tag.id} onClick={() => chooseTag(tag.id)}>{tag.name} ({tag.count})</ActionButton>)}</> : null}{canEdit ? <ActionButton type="button" aria-label="管理标签" title="管理标签" onClick={() => setTagManager(true)}><Tags size={16} /></ActionButton> : null}</div>
          <div className="quick-note-feedback" role="status">{message}</div>
          {error ? <div className="quick-note-error" role="alert">{error}{patch && !patching ? <Button onClick={() => void runPatch(patch)}>重试操作</Button> : null}</div> : null}
          {notes.isError || tags.isError || summary.isError ? <div className="quick-note-error" role="alert">随手记加载失败，请重试。<Button onClick={refresh}>重新加载</Button></div> : null}
          {notes.isPending ? <LoadingState label="正在加载随手记…" variant="cards" /> : null}
          {!notes.isPending && !notes.isError && !items.length ? <div className="quick-notes-empty"><StickyNote size={36} /><h2>{filter.deleted ? "回收站是空的" : filter.q || filter.tag ? "没有找到匹配的记录" : "记下第一个想法"}</h2><p>{filter.deleted ? "移入回收站的记录可以在这里恢复。" : filter.q || filter.tag ? "试试其他关键词或标签。" : "一句灵感、一段代码、一张图片，都可以从这里开始。"}</p></div> : null}
          <FileContentContext.Provider value={files}><div className={`quick-notes-records is-${view}`}>{items.map(note => <NoteCard key={note.id} note={note} tags={tagItems} canEdit={canEdit} disabled={Boolean(patch)} onEdit={() => setEditing(note)} onPatch={change => void runPatch({ id: note.id, body: { ...change, operation_id: crypto.randomUUID(), expected_version: note.version } })} />)}</div></FileContentContext.Provider>
          {notes.hasNextPage ? <Button className="quick-notes-load-more" isPending={notes.isFetchingNextPage} onClick={() => void notes.fetchNextPage()}>加载更多</Button> : null}
        </section>
      </div>
    </div>
    <QuickNoteTags open={tagManager} onOpenChange={setTagManager} tags={tagItems} onChanged={refresh} />
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null); }}><DialogContent title="编辑随手记" className="quick-note-edit-dialog">{editing ? <QuickNoteComposer key={editing.id} userId={user.id} workspaceId={workspace.id} note={editing} tags={tagItems} canEdit={canEdit} onManageTags={() => setTagManager(true)} onSaved={() => { setEditing(null); refresh(); }} /> : null}</DialogContent></Dialog>
  </DocumentShell>;
}

export function QuickNotesPage() {
  const scope = useStore(authStore, getAuthSessionKey);
  return <QuickNotesWorkspace key={scope} />;
}
