import {preparePendingNavigation} from "../../shared/navigation/pending-navigation";
import {newUUID} from "../../shared/ids";
import {ApiError} from "../../shared/api/api-client";
import { LoadingState } from "../../shared/ui/LoadingState";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { useIsMutating,useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronDown, FilePlus2, ListCollapse, ListTree, LocateFixed, MoreVertical, Pencil, Plus } from "../../shared/ui/icons";
import { type CSSProperties, type KeyboardEvent, type ReactNode, createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import type { Note,NoteTreeItem } from "../../shared/api/schemas";
import { authStore,getAuthSessionKey } from "../../shared/auth/auth-store";
import { formatNotebookUpdateTime } from "./notebook-update-time";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { dismissToast, showToast } from "../../shared/ui/Toast";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { ResourceDialog } from "./ResourceDialog";
import { DocumentLink } from "./DocumentLink";
import { documentRowSensors, documentTreePlugins } from "./document-row-drag";
import { useDocumentTreeExpansion } from "./document-tree-expansion";
import { useArchiveNote, useCreateNote, useNoteTree, useReorderNotes, useUpdateNote } from "./queries";

type InternalDocumentTreeSummary = {
  noteCount: number;
  noteIds: string[];
  rootCount: number;
  state: "loading" | "success" | "error";
};

type DocumentContextSummaryValue = {
  summary: InternalDocumentTreeSummary;
  publishSummary: (summary: InternalDocumentTreeSummary) => void;
};

const initialDocumentContextSummary: InternalDocumentTreeSummary = {
  noteCount: 0,
  noteIds: [],
  rootCount: 0,
  state: "loading",
};

const MAX_FOCUS_RESTORE_FRAMES = 12;

const DocumentContextSummaryContext = createContext<DocumentContextSummaryValue | null>(null);

export function DocumentContextSummaryProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState(initialDocumentContextSummary);
  const publishSummary = useCallback((next: InternalDocumentTreeSummary) => setSummary(next), []);
  const value = useMemo(() => ({ summary, publishSummary }), [publishSummary, summary]);

  return <DocumentContextSummaryContext.Provider value={value}>{children}</DocumentContextSummaryContext.Provider>;
}

export function useDocumentContextSummary(): InternalDocumentTreeSummary {
  const context = useContext(DocumentContextSummaryContext);
  if (!context) throw new Error("Document context summary requires its provider");
  return context.summary;
}

type DocumentContextPanelProps = {
  notebookId: string;
  activeNoteId?: string;
  mobile?: boolean;
  onNavigate?: () => void;
  /**
   * side: compact tree inside the shell's context panel (default).
   * main: full-width document list for the notebook page's main column;
   * the page itself supplies the header and primary actions.
   */
  variant?: "side" | "main";
};

type TreeNodeProps = {
  items: NoteTreeItem[];
  depth: number;
  parentId: string | null;
  activeNoteId?: string;
  canEdit: boolean;
  reordering: boolean;
  main?: boolean;
  onNavigate?: () => void;
  onCreateChild: (noteId: string) => void;
  onRename: (note: NoteTreeItem) => void;
  onArchive: (note: NoteTreeItem) => void;
  isExpanded: (noteId: string) => boolean;
  onToggle: (noteId: string) => void;
  onKeyboardMove: (noteId: string, delta: -1 | 1, link: HTMLAnchorElement) => void;
  dragInstructionsId: string;
};

function collectNoteIds(items: NoteTreeItem[]): string[] {
  return items.flatMap((item) => [item.id, ...collectNoteIds(item.children)]);
}

function findNote(items: NoteTreeItem[], noteId: string): NoteTreeItem | undefined {
  for (const item of items) {
    if (item.id === noteId) return item;
    const child = findNote(item.children, noteId);
    if (child) return child;
  }
  return undefined;
}

function findSiblingGroup(items: NoteTreeItem[], noteId: string, parentId: string | null = null): { parentId: string | null; items: NoteTreeItem[] } | undefined {
  if (items.some((item) => item.id === noteId)) return { parentId, items };
  for (const note of items) {
    const found = findSiblingGroup(note.children, noteId, note.id);
    if (found) return found;
  }
  return undefined;
}

type DocumentItemProps = Omit<TreeNodeProps, "items"> & { note: NoteTreeItem; index: number };
type SortableBinding = Pick<ReturnType<typeof useSortable>, "ref" | "targetRef" | "handleRef" | "isDragSource" | "isDropTarget">;

function SortableDocumentItem(props: DocumentItemProps) {
  const { note, index, parentId, reordering } = props;
  const group = parentId ?? "root";
  const sortable = useSortable({
    id: note.id,
    index,
    group,
    type: "document",
    accept: (source) => source.type === "document" && "group" in source && source.group === group,
    disabled: reordering,
    sensors: documentRowSensors,
  });
  return <DocumentItem {...props} sortable={sortable} />;
}

function DocumentRowActions({ note, reordering, onCreateChild, onRename, onArchive }: Pick<DocumentItemProps, "note" | "reordering" | "onCreateChild" | "onRename" | "onArchive">) {
  const [open, setOpen] = useState(false);
  return <div className="document-context-actions" data-document-row-action data-menu-open={open}>
    <Dropdown onOpenChange={setOpen}>
      <ActionButton type="button" className="icon-button" aria-label={`文档操作 ${note.title}`} title="更多操作" disabled={reordering}><MoreVertical aria-hidden="true" size={16} /></ActionButton>
      <Dropdown.Popover placement="bottom end" offset={4} className="document-actions-popover">
        <Dropdown.Menu aria-label={`文档操作 ${note.title}`} onAction={(key) => {
          if (key === "create") onCreateChild(note.id);
          if (key === "rename") onRename(note);
          if (key === "archive") onArchive(note);
        }}>
          <Dropdown.Item id="create" textValue="新建子文档" isDisabled={reordering}><Plus aria-hidden="true" /><Label>新建子文档</Label></Dropdown.Item>
          <Dropdown.Item id="rename" textValue="重命名" isDisabled={reordering}><Pencil aria-hidden="true" /><Label>重命名</Label></Dropdown.Item>
          <Dropdown.Item id="archive" textValue="归档" isDisabled={reordering} className="document-archive-action"><Archive aria-hidden="true" /><Label>归档</Label></Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
    <ActionButton type="button" className="icon-button document-create-child" aria-label={`新建子文档 ${note.title}`} title="新建子文档" disabled={reordering} onClick={() => onCreateChild(note.id)}><Plus aria-hidden="true" size={16} /></ActionButton>
  </div>;
}

function DocumentItem({ note, depth, parentId, activeNoteId, canEdit, reordering, main = false, onNavigate, onCreateChild, onRename, onArchive, onKeyboardMove, dragInstructionsId, isExpanded, onToggle, sortable }: DocumentItemProps & { sortable?: SortableBinding }) {
  const group = parentId ?? "root";
  const childrenId = useId();
  const expanded = isExpanded(note.id);
  const bindRow = useCallback((element: HTMLDivElement | null) => {
    sortable?.targetRef(element);
    sortable?.handleRef(element);
  }, [sortable?.targetRef, sortable?.handleRef]);
  function handleSortKey(event: KeyboardEvent<HTMLAnchorElement>) {
    if (!sortable || reordering || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    event.stopPropagation();
    onKeyboardMove(note.id, event.key === "ArrowUp" ? -1 : 1, event.currentTarget);
  }

  const prefix = <div className="document-tree-prefix">
    {note.children.length ? <ActionButton type="button" className="document-tree-disclosure" aria-label={`${expanded ? "收起" : "展开"}子目录 ${note.title}`} aria-expanded={expanded} aria-controls={childrenId} disabled={reordering} onClick={() => onToggle(note.id)}><ChevronDown aria-hidden="true" size={14} /></ActionButton> : <span className="document-disclosure-placeholder" aria-hidden="true" />}
  </div>;
  const actions = !main && canEdit ? <DocumentRowActions note={note} reordering={reordering} onCreateChild={onCreateChild} onRename={onRename} onArchive={onArchive} /> : null;
  const children = note.children.length && expanded ? <DocumentTree items={note.children} depth={depth + 1} parentId={note.id} activeNoteId={activeNoteId} canEdit={canEdit} reordering={reordering} main={main} onNavigate={onNavigate} onCreateChild={onCreateChild} onRename={onRename} onArchive={onArchive} onKeyboardMove={onKeyboardMove} dragInstructionsId={dragInstructionsId} isExpanded={isExpanded} onToggle={onToggle} /> : null;

  if (main) return <div ref={sortable?.ref} className="document-main-item" data-note-id={note.id} data-parent-id={group} data-dragging={sortable?.isDragSource} data-drop-target={sortable?.isDropTarget}>
    <div className="document-main-row">
      {prefix}
      <DocumentLink noteId={note.id} to={`/documents/${note.id}`} draggable={false} aria-label={note.title} aria-current={note.id === activeNoteId ? "page" : undefined} className="document-main-link" onClick={onNavigate}>
        <span className="document-main-title" title={note.title}>{note.title}</span>
        <span className="document-main-leader" aria-hidden="true" />
        <time dateTime={new Date(note.updated_at_ms).toISOString()} title={new Date(note.updated_at_ms).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}>{formatNotebookUpdateTime(note.updated_at_ms)}</time>
      </DocumentLink>
      {actions}
    </div>
    {note.children.length ? <div id={childrenId} className="document-main-children" hidden={!expanded}>{children}</div> : null}
  </div>;

  return <div ref={sortable?.ref} className="document-context-item" data-note-id={note.id} data-parent-id={group} data-dragging={sortable?.isDragSource} data-drop-target={sortable?.isDropTarget}>
    <div ref={bindRow} data-document-drag-row={sortable ? "true" : undefined} data-editable={canEdit} aria-busy={reordering || undefined} style={{ "--document-depth": depth } as CSSProperties} className={`document-context-row${note.id === activeNoteId ? " is-active" : ""}`}>
      {prefix}
      <DocumentLink noteId={note.id} to={`/documents/${note.id}`} data-document-row-link draggable={false} aria-current={note.id === activeNoteId ? "page" : undefined} aria-describedby={sortable ? dragInstructionsId : undefined} aria-keyshortcuts={sortable ? "Alt+ArrowUp Alt+ArrowDown" : undefined} className={`document-context-link ${note.id === activeNoteId ? "is-active" : ""}`} title={note.title} onClick={onNavigate} onKeyDown={handleSortKey}>
        <span>{note.title}</span>
      </DocumentLink>
      {actions}
    </div>
    {note.children.length ? <div id={childrenId} className="document-context-children" hidden={!expanded}>{children}</div> : null}
  </div>;
}

function DocumentTree({ items, ...props }: TreeNodeProps) {
  return items.map((note, index) => props.canEdit && items.length > 1
    ? <SortableDocumentItem key={note.id} note={note} index={index} {...props} />
    : <DocumentItem key={note.id} note={note} index={index} {...props} />);
}

export function DocumentContextPanel({ notebookId, activeNoteId, mobile = false, onNavigate, variant = "side" }: DocumentContextPanelProps) {
  const navigate = useNavigate();
  const client=useQueryClient();
  const sessionKey=useStore(authStore,getAuthSessionKey);
  const panelOwner=useMemo(()=>({active:true}),[notebookId,activeNoteId,sessionKey]);
  useEffect(()=>{panelOwner.active=true;return()=>{panelOwner.active=false;};},[panelOwner]);
  const summaryContext = useContext(DocumentContextSummaryContext);
  const workspace = useStore(authStore, (state) => state.workspace);
  const main = variant === "main";
  const canEdit = !main && canMutateWorkspaceContent(workspace);
  const treeQuery = useNoteTree(notebookId);
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const reorderNotes = useReorderNotes(notebookId);
  const reordering = useIsMutating({ mutationKey: ["note-reorder", notebookId] }) > 0;
  const archiveNote = useArchiveNote();
  const [createParent, setCreateParent] = useState<string | null | undefined>(undefined);
  const [renameTarget, setRenameTarget] = useState<NoteTreeItem | null>(null);
  const renameIntent=useRef<{title:string;operation_id:string;uncertain:boolean}|null>(null);
  const [sortAnnouncement, setSortAnnouncement] = useState("");
  const treeRef = useRef<HTMLElement>(null);
  const dragInstructionsId = useId();
  const noteIds = useMemo(() => collectNoteIds(treeQuery.data?.items ?? []), [treeQuery.data?.items]);
  const treeItems = treeQuery.data?.items ?? [];
  const { isExpanded, toggle, expandAll, collapseAll, reveal, hasBranches, allExpanded } = useDocumentTreeExpansion(workspace?.id, notebookId, treeItems, activeNoteId, variant);

  function locateCurrent() {
    if (!activeNoteId || !reveal(activeNoteId)) return;
    requestAnimationFrame(() => {
      const link = treeRef.current?.querySelector<HTMLElement>(`[data-note-id="${activeNoteId}"] > .document-context-row > .document-context-link`);
      link?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      link?.focus({ preventScroll: true });
    });
  }

  useEffect(() => {
    summaryContext?.publishSummary({
      noteCount: noteIds.length,
      noteIds,
      rootCount: treeItems.length,
      state: treeQuery.isError ? "error" : treeQuery.isLoading ? "loading" : "success",
    });
  }, [noteIds, summaryContext?.publishSummary, treeItems.length, treeQuery.isError, treeQuery.isLoading]);

  async function handleCreate(title: string) {
    await preparePendingNavigation();
    if(!panelOwner.active)return;
    const parent = createParent ? findNote(treeItems, createParent) : undefined;
    const note = await createNote.mutateAsync({
      notebook_id: notebookId,
      title,
      parent_id: createParent ?? null,
      sort_order: parent ? parent.children.length : treeItems.length,
    });
    if(!panelOwner.active)return;
    setCreateParent(undefined);
    navigate(`/documents/${note.id}`);
  }

  async function openRename(note:NoteTreeItem){
    await preparePendingNavigation();
    if(!panelOwner.active)return;
    const cached=client.getQueryData<Note>(["note",note.id]);
    renameIntent.current=null;
    setRenameTarget(cached&&cached.workspace_id===workspace?.id?{...note,...cached,children:note.children}:note);
  }
  async function handleRename(title: string) {
    if (!renameTarget) return;
    if(renameIntent.current&&renameIntent.current.title!==title){
      if(renameIntent.current.uncertain)throw new Error(`上次重命名尚未确认，请先重试“${renameIntent.current.title}”，或关闭后重新读取文档。`);
      renameIntent.current=null;
    }
    renameIntent.current??={title,operation_id:newUUID(),uncertain:false};
    const intent=renameIntent.current;
    try{
      await updateNote.mutateAsync({id:renameTarget.id,title,expected_version:renameTarget.content_version,operation_id:intent.operation_id});
      if(panelOwner.active){renameIntent.current=null;setRenameTarget(null);}
    }catch(error){
      if(renameIntent.current===intent){
        if(!(error instanceof ApiError)||error.status>=500)intent.uncertain=true;
        else if(!intent.uncertain)renameIntent.current=null;
      }
      throw error;
    }
  }

  async function handleArchive(note: NoteTreeItem) {
    await preparePendingNavigation();
    if(!panelOwner.active)return;
    if (!treeQuery.data?.directory_version) throw new Error("目录版本尚未载入，请重新载入。");
    const archived = await archiveNote.mutateAsync({ id: note.id, archived: true,expected_directory_version:treeQuery.data.directory_version });
    if(!panelOwner.active)return;
    let undoPending = false;
    const toastId = showToast({
      title: "文档已归档",
      description: note.title,
      tone: "success",
      timeout: 0,
      action: {
        label: "撤销",
        onPress: () => {
          if (undoPending) return;
          if(getAuthSessionKey(authStore.getState())!==sessionKey){dismissToast(toastId);return;}
          undoPending = true;
          void archiveNote.mutateAsync({ id: note.id, archived: false,expected_directory_version:archived.directory_version })
            .then(() => dismissToast(toastId))
            .catch((error) => showToast({ title: "恢复文档失败", description: error instanceof Error ? error.message : "请稍后重试。", tone: "danger" }))
            .finally(() => { undoPending = false; });
        },
      },
    });
    if (note.id === activeNoteId) navigate(`/collections/${notebookId}`, { replace: true });
  }

  async function handleReorder(noteId: string, targetIndex: number, focusLink?: HTMLAnchorElement) {
    if (!canEdit || reordering) return;
    const group = findSiblingGroup(treeItems, noteId);
    if (!group) return;
    const currentIds = group.items.map((note) => note.id);
    const initialIndex = currentIds.indexOf(noteId);
    if (targetIndex < 0 || targetIndex >= currentIds.length || targetIndex === initialIndex) return;
    const noteIds = [...currentIds];
    noteIds.splice(initialIndex, 1);
    noteIds.splice(targetIndex, 0, noteId);
    try {
      await reorderNotes.mutateAsync({ parent_id: group.parentId,expected_directory_version:treeQuery.data!.directory_version, expected_note_ids: currentIds, note_ids: noteIds });
      setSortAnnouncement(`已将 ${findNote(treeItems, noteId)?.title ?? "文档"} 移至同级第 ${targetIndex + 1} 位`);
    } catch (error) {
      showToast({ title: "排序未保存", description: error instanceof Error ? error.message : "请刷新后重试。", tone: "danger" });
    } finally {
      const focusMayBeRestored = document.activeElement === focusLink || document.activeElement === document.body;
      if (focusLink && focusMayBeRestored) {
        // The tree can remount as the optimistic order is reconciled with the server.
        let remainingFrames = MAX_FOCUS_RESTORE_FRAMES;
        const restoreWhenReady = () => {
          if (remainingFrames-- <= 0) return;
          const link = treeRef.current?.querySelector<HTMLAnchorElement>(`[data-note-id="${noteId}"] > .document-context-row > .document-context-link`);
          const active = document.activeElement;
          if (active !== focusLink && active !== document.body && active !== link) return;
          if (link && active !== link) link.focus();
          requestAnimationFrame(restoreWhenReady);
        };
        requestAnimationFrame(restoreWhenReady);
      }
    }
  }

  return (
    <section className={main ? "document-main-list" : "document-context"} aria-label={main ? undefined : "文档目录"}>
      {main ? null : (
        <div className="document-context-header">
          <h2><ListTree size={18} aria-hidden="true" /><span>目录</span></h2>
          <div className="document-tree-tools">
            <ActionButton type="button" className="icon-button" aria-label="定位当前文档" title="定位当前文档" disabled={!activeNoteId || !noteIds.includes(activeNoteId)} onClick={locateCurrent}><LocateFixed size={18} aria-hidden="true" /></ActionButton>
            <ActionButton type="button" className="icon-button" aria-label={allExpanded ? "收起全部目录" : "展开全部目录"} title={allExpanded ? "收起全部目录" : "展开全部目录"} disabled={!hasBranches || reordering} onClick={allExpanded ? collapseAll : expandAll}><ListCollapse size={18} aria-hidden="true" /></ActionButton>
          </div>
        </div>
      )}
      {treeQuery.isError ? <StatusMessage tone="error" title="目录加载失败"><Button className="mt-3" variant="secondary" onClick={() => void treeQuery.refetch()}>重试加载目录</Button></StatusMessage> : null}
      {treeQuery.isLoading ? <LoadingState label="正在加载文档目录…" compact={!main} /> : null}
      {!treeQuery.isLoading && !treeQuery.isError && !treeItems.length ? (
        main ? (
          <div className="empty-panel py-14">
            <FilePlus2 aria-hidden="true" className="mx-auto mb-3" size={24} />
            <div className="font-semibold text-[var(--text-primary)]">从第一篇文档开始</div>
            <p className="mt-1">可以直接写作，也可以导入已有 Markdown。</p>
          </div>
        ) : (
          <div className="document-tree-empty text-xs leading-5 text-[var(--muted)]">这个笔记本还没有文档。{canEdit ? <Button size="sm" onClick={() => setCreateParent(null)}>新建文档</Button> : null}</div>
        )
      ) : null}
      {canEdit ? <span id={dragInstructionsId} className="sr-only">拖动目录行可调整同级顺序；聚焦文档链接后，按 Alt 加上下方向键排序。</span> : null}
      {canEdit ? <span className="sr-only" role="status" aria-label="目录排序状态" aria-live="polite">{sortAnnouncement}</span> : null}
      {!treeQuery.isLoading && !treeQuery.isError ? <DragDropProvider plugins={documentTreePlugins} onDragEnd={(event) => {
        const source = event.operation.source;
        if (event.canceled || !isSortable(source) || source.initialGroup !== source.group || source.initialIndex === source.index) return;
        void handleReorder(String(source.id), source.index);
      }}><nav ref={treeRef} className={main ? "document-main-list" : "document-context-tree"} aria-label={main ? "文档列表" : "笔记本文档"}><DocumentTree items={treeItems} depth={0} parentId={null} activeNoteId={activeNoteId} canEdit={canEdit} reordering={reordering} main={main} onNavigate={mobile ? onNavigate : undefined} onCreateChild={setCreateParent} onRename={note=>{void openRename(note).catch(error=>{if(panelOwner.active)showToast({title:"无法重命名文档",description:error instanceof Error?error.message:"请稍后重试。",tone:"danger"});});}} onArchive={(note) => void handleArchive(note).catch((error) => showToast({ title: "归档失败", description: error instanceof Error ? error.message : "请稍后重试。", tone: "danger" }))} onKeyboardMove={(noteId, delta, link) => void handleReorder(noteId, (findSiblingGroup(treeItems, noteId)?.items.findIndex((item) => item.id === noteId) ?? -1) + delta, link)} dragInstructionsId={dragInstructionsId} isExpanded={isExpanded} onToggle={toggle} /></nav></DragDropProvider> : null}
      <ResourceDialog open={createParent !== undefined} title={createParent ? "新建子文档" : "新建文档"} label="文档标题" placeholder="未命名文档" submitLabel="创建并打开" pending={createNote.isPending} onClose={() => setCreateParent(undefined)} onSubmit={handleCreate} />
      <ResourceDialog open={Boolean(renameTarget)} title="重命名文档" label="文档标题" placeholder="文档标题" initialValue={renameTarget?.title ?? ""} submitLabel="保存" pending={updateNote.isPending} onClose={() => {renameIntent.current=null;setRenameTarget(null);}} onSubmit={handleRename} />
    </section>
  );
}
