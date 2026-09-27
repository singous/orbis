import { ActionButton } from "../../shared/ui/ActionButton";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { useIsMutating } from "@tanstack/react-query";
import { Archive, FilePlus2, GripVertical, Pencil, Plus } from "lucide-react";
import { type KeyboardEvent, type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import type { NoteTreeItem } from "../../shared/api/schemas";
import { authStore } from "../../shared/auth/auth-store";
import { formatDate } from "../../shared/format/date";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { dismissToast, showToast } from "../../shared/ui/Toast";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { ResourceDialog } from "./ResourceDialog";
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
  onKeyboardMove: (noteId: string, delta: -1 | 1, handle: HTMLButtonElement) => void;
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
  });
  return <DocumentItem {...props} sortable={sortable} />;
}

function DocumentItem({ note, depth, parentId, activeNoteId, canEdit, reordering, main = false, onNavigate, onCreateChild, onRename, onArchive, onKeyboardMove, sortable }: DocumentItemProps & { sortable?: SortableBinding }) {
  const group = parentId ?? "root";
  function handleSortKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    event.stopPropagation();
    onKeyboardMove(note.id, event.key === "ArrowUp" ? -1 : 1, event.currentTarget);
  }

  // The drag sensor owns pointer and keyboard activation on this handle.
  const dragHandle = sortable ? <button ref={sortable.handleRef} type="button" className="document-drag-handle" aria-label={`拖动排序 ${note.title}`} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title="拖动排序；Alt+方向键移动" disabled={reordering} onKeyDown={handleSortKey}><GripVertical aria-hidden="true" size={15} /></button> : null;
  const actions = canEdit ? <div className="document-context-actions">
    <ActionButton type="button" className="icon-button" aria-label={`新建子文档 ${note.title}`} title="新建子文档" disabled={reordering} onClick={() => onCreateChild(note.id)}><Plus aria-hidden="true" size={15} /></ActionButton>
    <ActionButton type="button" className="icon-button" aria-label={`重命名 ${note.title}`} title="重命名" disabled={reordering} onClick={() => onRename(note)}><Pencil aria-hidden="true" size={14} /></ActionButton>
    <ActionButton type="button" className="icon-button danger-hover" aria-label={`归档 ${note.title}`} title="归档" disabled={reordering} onClick={() => onArchive(note)}><Archive aria-hidden="true" size={15} /></ActionButton>
  </div> : null;
  const children = note.children.length ? <DocumentTree items={note.children} depth={depth + 1} parentId={note.id} activeNoteId={activeNoteId} canEdit={canEdit} reordering={reordering} main={main} onNavigate={onNavigate} onCreateChild={onCreateChild} onRename={onRename} onArchive={onArchive} onKeyboardMove={onKeyboardMove} /> : null;

  if (main) return <div ref={sortable?.ref} className="document-main-item" data-note-id={note.id} data-parent-id={group} data-dragging={sortable?.isDragSource} data-drop-target={sortable?.isDropTarget}>
    <div ref={sortable?.targetRef} className={`document-main-row${sortable ? " has-drag-handle" : ""}`}>
      {dragHandle}
      <Link to={`/documents/${note.id}`} aria-label={note.title} aria-current={note.id === activeNoteId ? "page" : undefined} className="document-main-link" onClick={onNavigate}>
        <FilePlus2 aria-hidden="true" size={15} />
        <span className="document-main-title" title={note.title}>{note.title}</span>
        <time>{formatDate(note.updated_at_ms)}</time>
      </Link>
      {actions}
    </div>
    {children ? <div className="document-main-children">{children}</div> : null}
  </div>;

  return <div ref={sortable?.ref} className="document-context-item" data-note-id={note.id} data-parent-id={group} data-dragging={sortable?.isDragSource} data-drop-target={sortable?.isDropTarget} style={{ paddingLeft: `${12 + depth * 16}px` }}>
    <div ref={sortable?.targetRef} className={`document-context-row${sortable ? " has-drag-handle" : ""}${note.id === activeNoteId ? " is-active" : ""}`}>
      {dragHandle}
      <Link to={`/documents/${note.id}`} aria-current={note.id === activeNoteId ? "page" : undefined} className={`document-context-link ${note.id === activeNoteId ? "is-active" : ""}`} title={note.title} onClick={onNavigate}>
        <FilePlus2 aria-hidden="true" size={13} />
        <span>{note.title}</span>
      </Link>
      {actions}
    </div>
    {children}
  </div>;
}

function DocumentTree({ items, ...props }: TreeNodeProps) {
  return items.map((note, index) => props.canEdit && items.length > 1
    ? <SortableDocumentItem key={note.id} note={note} index={index} {...props} />
    : <DocumentItem key={note.id} note={note} index={index} {...props} />);
}

export function DocumentContextPanel({ notebookId, activeNoteId, mobile = false, onNavigate, variant = "side" }: DocumentContextPanelProps) {
  const navigate = useNavigate();
  const summaryContext = useContext(DocumentContextSummaryContext);
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const treeQuery = useNoteTree(notebookId);
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const reorderNotes = useReorderNotes(notebookId);
  const reordering = useIsMutating({ mutationKey: ["note-reorder", notebookId] }) > 0;
  const archiveNote = useArchiveNote();
  const [createParent, setCreateParent] = useState<string | null | undefined>(undefined);
  const [renameTarget, setRenameTarget] = useState<NoteTreeItem | null>(null);
  const noteIds = useMemo(() => collectNoteIds(treeQuery.data?.items ?? []), [treeQuery.data?.items]);
  const treeItems = treeQuery.data?.items ?? [];
  const main = variant === "main";

  useEffect(() => {
    summaryContext?.publishSummary({
      noteCount: noteIds.length,
      noteIds,
      rootCount: treeItems.length,
      state: treeQuery.isError ? "error" : treeQuery.isLoading ? "loading" : "success",
    });
  }, [noteIds, summaryContext?.publishSummary, treeItems.length, treeQuery.isError, treeQuery.isLoading]);

  async function handleCreate(title: string) {
    const parent = createParent ? findNote(treeItems, createParent) : undefined;
    const note = await createNote.mutateAsync({
      notebook_id: notebookId,
      title,
      parent_id: createParent ?? null,
      sort_order: parent ? parent.children.length : treeItems.length,
    });
    setCreateParent(undefined);
    navigate(`/documents/${note.id}`);
  }

  async function handleRename(title: string) {
    if (!renameTarget) return;
    await updateNote.mutateAsync({ id: renameTarget.id, title });
    setRenameTarget(null);
  }

  async function handleArchive(note: NoteTreeItem) {
    await archiveNote.mutateAsync({ id: note.id, archived: true });
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
          undoPending = true;
          void archiveNote.mutateAsync({ id: note.id, archived: false })
            .then(() => dismissToast(toastId))
            .catch((error) => showToast({ title: "恢复文档失败", description: error instanceof Error ? error.message : "请稍后重试。", tone: "danger" }))
            .finally(() => { undoPending = false; });
        },
      },
    });
    if (note.id === activeNoteId) navigate(`/collections/${notebookId}`, { replace: true });
  }

  async function handleReorder(noteId: string, targetIndex: number, focusHandle?: HTMLButtonElement) {
    if (reordering) return;
    const group = findSiblingGroup(treeItems, noteId);
    if (!group) return;
    const currentIds = group.items.map((note) => note.id);
    const initialIndex = currentIds.indexOf(noteId);
    if (targetIndex < 0 || targetIndex >= currentIds.length || targetIndex === initialIndex) return;
    const noteIds = [...currentIds];
    noteIds.splice(initialIndex, 1);
    noteIds.splice(targetIndex, 0, noteId);
    try {
      await reorderNotes.mutateAsync({ parent_id: group.parentId, expected_note_ids: currentIds, note_ids: noteIds });
    } catch (error) {
      showToast({ title: "排序未保存", description: error instanceof Error ? error.message : "请刷新后重试。", tone: "danger" });
    } finally {
      const focusMayBeRestored = document.activeElement === focusHandle || document.activeElement === document.body;
      if (focusHandle && focusMayBeRestored) {
        // The tree can remount as the optimistic order is reconciled with the server.
        let remainingFrames = MAX_FOCUS_RESTORE_FRAMES;
        const restoreWhenReady = () => {
          if (remainingFrames-- <= 0) return;
          const tree = document.querySelector<HTMLElement>(`nav[aria-label="${main ? "文档列表" : "笔记本文档"}"]`);
          const handle = tree?.querySelector<HTMLButtonElement>(`[data-note-id="${noteId}"] > div > .document-drag-handle`);
          const active = document.activeElement;
          if (active !== focusHandle && active !== document.body && active !== handle) return;
          if (handle && handle.getAttribute("aria-disabled") !== "true" && active !== handle) handle.focus();
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
          <h2>文档目录</h2>
          {canEdit ? <Button variant="secondary" className="document-context-create" icon={<Plus aria-hidden="true" size={14} />} onClick={() => setCreateParent(null)}>新建文档</Button> : null}
        </div>
      )}
      {treeQuery.isError ? <StatusMessage tone="error" title="目录加载失败"><Button className="mt-3" variant="secondary" onClick={() => void treeQuery.refetch()}>重试加载目录</Button></StatusMessage> : null}
      {treeQuery.isLoading ? <div className={main ? "empty-panel" : "px-3 py-5 text-xs text-[var(--muted)]"}>正在加载文档目录…</div> : null}
      {!treeQuery.isLoading && !treeQuery.isError && !treeItems.length ? (
        main ? (
          <div className="empty-panel py-14">
            <FilePlus2 aria-hidden="true" className="mx-auto mb-3" size={24} />
            <div className="font-semibold text-black">从第一篇文档开始</div>
            <p className="mt-1">可以直接写作，也可以导入已有 Markdown。</p>
          </div>
        ) : (
          <div className="px-3 py-5 text-xs leading-5 text-[var(--muted)]">这个笔记本还没有文档。{canEdit ? "从第一篇文档开始吧。" : ""}</div>
        )
      ) : null}
      {!treeQuery.isLoading && !treeQuery.isError ? <DragDropProvider onDragEnd={(event) => {
        const source = event.operation.source;
        if (event.canceled || !isSortable(source) || source.initialGroup !== source.group || source.initialIndex === source.index) return;
        void handleReorder(String(source.id), source.index);
      }}><nav className={main ? "document-main-list" : "document-context-tree"} aria-label={main ? "文档列表" : "笔记本文档"}><DocumentTree items={treeItems} depth={0} parentId={null} activeNoteId={activeNoteId} canEdit={canEdit} reordering={reordering} main={main} onNavigate={mobile ? onNavigate : undefined} onCreateChild={setCreateParent} onRename={setRenameTarget} onArchive={(note) => void handleArchive(note)} onKeyboardMove={(noteId, delta, handle) => void handleReorder(noteId, (findSiblingGroup(treeItems, noteId)?.items.findIndex((item) => item.id === noteId) ?? -1) + delta, handle)} /></nav></DragDropProvider> : null}
      <ResourceDialog open={createParent !== undefined} title={createParent ? "新建子文档" : "新建文档"} label="文档标题" placeholder="未命名文档" submitLabel="创建并打开" pending={createNote.isPending} onClose={() => setCreateParent(undefined)} onSubmit={handleCreate} />
      <ResourceDialog open={Boolean(renameTarget)} title="重命名文档" label="文档标题" placeholder="文档标题" initialValue={renameTarget?.title ?? ""} submitLabel="保存" pending={updateNote.isPending} onClose={() => setRenameTarget(null)} onSubmit={handleRename} />
    </section>
  );
}
