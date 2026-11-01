import { cn } from "@orbis/ui/cn";
import { PageHeader } from "../../shared/ui/PageHeader";
import { cardSurfaceClassName } from "../../shared/ui/surface-styles";
import { reportError } from "../../shared/api/request-feedback";
import { newUUID } from "../../shared/ids";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { StickyNote, Tags, LayoutGrid, List } from "@orbis/ui/icons";
import { Toggle } from "@orbis/ui/toggle";
import { Toolbar } from "@orbis/ui/toolbar";
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
import { EmptyState } from "../../shared/ui/EmptyState";
import { LoadingState } from "../../shared/ui/LoadingState";
import { DocumentShell } from "../documents/DocumentShell";
import { ContentRenderer } from "../content/ContentRenderer";
import { FileContentContext } from "../files/FileContent";
import { useManagedFiles } from "../files/use-managed-files";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { listQuickNotes, patchQuickNote, type NoteFilter, type QuickNote, type QuickNoteTag } from "./api";
import { quickNoteTagsQueryOptions, quickNoteSummaryQueryOptions } from "./metadata-queries";
import { editorBlocks } from "./QuickNoteEditor";
import { QuickNoteComposer } from "./QuickNoteComposer";
import { QuickNoteTags } from "./QuickNoteTags";

const noteActionClassName = "grid size-(--ob-control-height-sm) place-items-center rounded-ob-sm hover:bg-(--ob-item-hover-bg) hover:text-ob-foreground";
const viewActionClassName = "grid size-(--ob-control-height-sm) place-items-center rounded-ob-sm text-(--ob-page-muted-foreground) aria-pressed:bg-ob-card aria-pressed:text-ob-foreground aria-pressed:shadow-ob-panel";

const viewOptions = [
  { value: "list", label: "列表视图", Icon: List },
  { value: "cards", label: "卡片视图", Icon: LayoutGrid },
] as const;

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
  const actions = note.deleted_at_ms !== null ? [
    { id: "restore", label: "恢复记录", Icon: ArchiveRestore, run: () => onPatch({ is_deleted: false }) },
  ] : [
    { id: "edit", label: "编辑记录", Icon: Pencil, run: onEdit },
    { id: "pin", label: note.is_pinned ? "取消置顶" : "置顶记录", Icon: Pin, run: () => onPatch({ is_pinned: !note.is_pinned }) },
    { id: "archive", label: "移入回收站", Icon: Trash2, run: () => onPatch({ is_deleted: true }) },
  ];
  // 截断高度与上面的溢出测量保持相同像素值，缩放后也保留展开入口。
  return <article className={cn(cardSurfaceClassName, "quick-note-card px-6 py-4 [@media(max-width:650px)]:px-4")} aria-label="随手记记录">
    <header className="quick-note-card-heading mb-4 flex flex-wrap items-center gap-2 text-xs leading-5 text-(--ob-page-muted-foreground)"><time dateTime={new Date(note.updated_at_ms).toISOString()}>更新于 {noteTime.format(note.updated_at_ms)}</time>{note.is_pinned ? <Pin aria-label="已置顶" size={14} /> : null}
      {canEdit ? <div className="quick-note-card-actions ms-auto flex items-center">{actions.map(({ id, label, Icon, run }) => <ActionButton key={id} className={noteActionClassName} disabled={disabled} aria-label={label} title={label} onClick={run}><Icon size={15} /></ActionButton>)}</div> : null}
    </header>
    <div className={cn("quick-note-card-content quick-note-content overflow-hidden text-sm leading-(--ob-prose-body-leading) wrap-anywhere", expanded ? "max-h-none" : "max-h-[320px]")} ref={content}><ContentRenderer blocks={editorBlocks(note.blocks)} /></div>
    <footer className="quick-note-card-footer mt-3 flex items-end justify-between gap-2"><div className="quick-note-card-tags flex min-w-0 flex-wrap gap-1">{note.tag_ids.map(id => <Tag key={id} className="h-auto max-w-full wrap-anywhere">{tags.find(tag => tag.id === id)?.name ?? "标签"}</Tag>)}</div>{overflow || expanded ? <ActionButton className="flex min-h-(--ob-control-height-sm) shrink-0 items-center gap-1 text-xs leading-5 text-ob-primary" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><ChevronDown size={14} />{expanded ? "收起" : "展开"}</ActionButton> : null}</footer>
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

  useEffect(() => { const timer = setTimeout(() => setFilter(value => ({ ...value, q: search })), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { if (!expanded) return; const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [expanded]);
  const notes = useInfiniteQuery({ queryKey: [...prefix, "list", filter], queryFn: ({ pageParam, signal }) => listQuickNotes(auth, filter, pageParam, signal), initialPageParam: 1, getNextPageParam: last => last.pagination.page * last.pagination.page_size < last.pagination.total ? last.pagination.page + 1 : undefined });
  const tags = useQuery(quickNoteTagsQueryOptions(auth, sessionKey));
  const summary = useQuery(quickNoteSummaryQueryOptions(auth, sessionKey));
  const tagItems = tags.data?.items ?? [];
  const items = [...new Map((notes.data?.pages.flatMap(page => page.items) ?? []).map(note => [note.id, note])).values()];
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: prefix }); };
  async function runPatch(next: PendingPatch) {
    if (patchLock.current) return;
    patchLock.current = true; setPatch(next); setPatching(true);
    try { await patchQuickNote({ ...auth, feedback: { success: true } }, next.id, next.body); setPatch(null);  refresh(); }
    catch (error) { reportError(error); if (error instanceof ApiError && error.status < 500 && ![408, 429].includes(error.status)) { setPatch(null); refresh(); } }
    finally { patchLock.current = false; setPatching(false); }
  }
  function chooseTag(tag: string) { setFilter(value => ({ ...value, tag })); }
  return <DocumentShell>
    <div className="quick-notes-page mx-auto max-w-[1800px] p-6 [@media(max-width:650px)]:p-4">
      <PageHeader layout="compact" className="quick-notes-heading" title="随手记" description="把零散的想法，留在这里" actionsProps={{ className: "quick-notes-view flex rounded-ob-lg bg-ob-surface-secondary p-[3px]", role: "group", "aria-label": "记录展示方式" }} actions={<>{patch && !patching ? <Button onClick={() => void runPatch(patch)}>重试操作</Button> : null}{viewOptions.map(({ value, label, Icon }) => <ActionButton key={value} className={viewActionClassName} title={label} aria-label={label} aria-pressed={view === value} onClick={() => setView(value)}><Icon size={17} /></ActionButton>)}</>} />
      <div className={cn("quick-notes-layout grid items-start gap-6 [@media(max-width:650px)]:gap-4", expanded ? "grid-cols-1" : "grid-cols-[minmax(300px,.8fr)_minmax(0,1.2fr)] [@media(max-width:1100px)]:grid-cols-1")}>
        <QuickNoteComposer userId={user.id} workspaceId={workspace.id} tags={tagItems} canEdit={canEdit} expanded={expanded} onToggleExpanded={() => setExpanded(value => !value)} onManageTags={() => setTagManager(true)} onSaved={() => { refresh(); setFilter(value => ({ ...value, q: "", tag: "", deleted: false })); setSearch(""); }} />
        <section className={cn("quick-notes-feed min-w-0", expanded && "hidden")} aria-label="历史记录">
          <div className="quick-notes-filters mb-4 flex items-center gap-2 [@media(max-width:650px)]:flex-wrap"><div className="quick-notes-search flex min-w-[100px] flex-1 items-center [@media(max-width:650px)]:basis-full"><TextInput className="min-w-0" aria-label="搜索随手记" placeholder="搜索记录…" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></div><SelectField className="w-[140px] flex-[0_0_140px]" aria-label="记录排序" density="compact" value={filter.sort} options={[{ value: "updated", label: "最近更新" }, { value: "created", label: "最近创建" }]} onChange={value => setFilter(current => ({ ...current, sort: value as NoteFilter["sort"] }))} /><ActionButton className="grid size-(--ob-control-height-md) shrink-0 place-items-center rounded-ob-sm aria-pressed:bg-ob-surface-secondary aria-pressed:text-ob-primary" aria-label={filter.deleted ? "返回全部记录" : "查看回收站"} title={filter.deleted ? "返回全部记录" : "查看回收站"} aria-pressed={filter.deleted} onClick={() => setFilter(current => ({ ...current, deleted: !current.deleted, tag: "" }))}><Trash2 size={17} /></ActionButton></div>
          <div className="quick-notes-tag-filters mb-4 flex flex-wrap items-center gap-2">
            <Toolbar className="quick-notes-tag-toggle-group max-w-full flex-wrap justify-start gap-2" aria-label="按标签筛选">
              <Toggle className="max-w-full whitespace-normal wrap-anywhere" pressed={!filter.tag} onPressedChange={selected => { if (selected) chooseTag(""); }}>{filter.deleted ? "回收站" : "全部"} {summary.data ? `(${filter.deleted ? summary.data.deleted : summary.data.total})` : ""}</Toggle>
              {!filter.deleted && tagItems.map(tag => <Toggle key={tag.id} className="max-w-full whitespace-normal wrap-anywhere" pressed={filter.tag === tag.id} onPressedChange={selected => { if (selected) chooseTag(tag.id); }}>{tag.name} ({tag.count})</Toggle>)}
            </Toolbar>
            {canEdit ? <ActionButton className="quick-notes-manage-tags inline-flex min-h-(--ob-control-height-sm) min-w-(--ob-control-height-sm) items-center justify-center rounded-ob-sm text-(--ob-page-muted-foreground)" aria-label="管理标签" title="管理标签" onClick={() => setTagManager(true)}><Tags size={16} /></ActionButton> : null}
          </div>

          {notes.isPending ? <LoadingState label="正在加载随手记…" variant="cards" /> : null}
          {!notes.isPending && !notes.isError && !items.length ? <EmptyState appearance="plain" className="quick-notes-empty min-h-[340px]" icon={<StickyNote size={36} />} title={filter.deleted ? "回收站是空的" : filter.q || filter.tag ? "没有找到匹配的记录" : "记下第一个想法"} description={filter.deleted ? "移入回收站的记录可以在这里恢复。" : filter.q || filter.tag ? "试试其他关键词或标签。" : "一句灵感、一段代码、一张图片，都可以从这里开始。"} /> : null}
          <FileContentContext.Provider value={files}><div className={cn("quick-notes-records grid items-start gap-4", view === "cards" && "grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] [@media(max-width:1100px)]:grid-cols-2 [@media(max-width:650px)]:grid-cols-1")}>{items.map(note => <NoteCard key={note.id} note={note} tags={tagItems} canEdit={canEdit} disabled={Boolean(patch)} onEdit={() => setEditing(note)} onPatch={change => void runPatch({ id: note.id, body: { ...change, operation_id: newUUID(), expected_version: note.version } })} />)}</div></FileContentContext.Provider>
          {notes.hasNextPage ? <Button className="quick-notes-load-more mx-auto mt-6 flex" isPending={notes.isFetchingNextPage} onClick={() => void notes.fetchNextPage()}>加载更多</Button> : null}
        </section>
      </div>
    </div>
    <QuickNoteTags open={tagManager} onOpenChange={setTagManager} tags={tagItems} onChanged={refresh} />
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null); }}><DialogContent title="编辑随手记" className="quick-note-edit-dialog w-[min(720px,calc(100vw-32px))]">{editing ? <QuickNoteComposer appearance="dialog" key={editing.id} userId={user.id} workspaceId={workspace.id} note={editing} tags={tagItems} canEdit={canEdit} onManageTags={() => setTagManager(true)} onSaved={() => { setEditing(null); refresh(); }} /> : null}</DialogContent></Dialog>
  </DocumentShell>;
}

export function QuickNotesPage() {
  const scope = useStore(authStore, getAuthSessionKey);
  return <QuickNotesWorkspace key={scope} />;
}
