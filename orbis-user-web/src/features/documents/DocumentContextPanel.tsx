import { Archive, ArrowDown, ArrowUp, FilePlus2, MoreHorizontal, Plus, Undo2 } from "lucide-react";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStore } from "zustand";

import type { NoteTreeItem } from "../../shared/api/schemas";
import { authStore } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { ResourceDialog } from "./ResourceDialog";
import { useArchiveNote, useCreateNote, useNoteTree, useUpdateNote } from "./queries";

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
  activeNoteId?: string;
  canEdit: boolean;
  main?: boolean;
  onNavigate?: () => void;
  onCreateChild: (noteId: string) => void;
  onRename: (note: NoteTreeItem) => void;
  onArchive: (note: NoteTreeItem) => void;
  onMove: (note: NoteTreeItem, delta: -1 | 1) => void;
};

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

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

function DocumentTree({ items, depth, activeNoteId, canEdit, main = false, onNavigate, onCreateChild, onRename, onArchive, onMove }: TreeNodeProps) {
  if (main) {
    return items.map((note, index) => (
      <div key={note.id} className="document-main-item">
        <div className="group flex min-w-0 items-center gap-1 rounded-lg px-3 transition hover:bg-[var(--surface-hover)]">
          <Link
            to={`/documents/${note.id}`}
            aria-current={note.id === activeNoteId ? "page" : undefined}
            className="flex min-w-0 flex-1 items-center gap-3 py-2.5"
            onClick={onNavigate}
          >
            <FilePlus2 aria-hidden="true" size={15} className="flex-none text-[var(--muted-light)]" />
            <span className={`truncate text-sm ${note.id === activeNoteId ? "font-semibold" : "font-medium"}`}>{note.title}</span>
          </Link>
          {canEdit ? (
            <div className="document-context-actions">
              <button type="button" className="icon-button" aria-label={`上移 ${note.title}`} onClick={() => onMove(note, -1)} disabled={index === 0}><ArrowUp aria-hidden="true" size={13} /></button>
              <button type="button" className="icon-button" aria-label={`下移 ${note.title}`} onClick={() => onMove(note, 1)} disabled={index === items.length - 1}><ArrowDown aria-hidden="true" size={13} /></button>
              <button type="button" className="icon-button" aria-label={`新建子文档 ${note.title}`} onClick={() => onCreateChild(note.id)}><Plus aria-hidden="true" size={13} /></button>
              <button type="button" className="icon-button" aria-label={`重命名 ${note.title}`} onClick={() => onRename(note)}><MoreHorizontal aria-hidden="true" size={13} /></button>
              <button type="button" className="icon-button danger-hover" aria-label={`归档 ${note.title}`} onClick={() => onArchive(note)}><Archive aria-hidden="true" size={13} /></button>
            </div>
          ) : null}
          <time className="flex-none pl-2 text-xs text-[var(--muted-light)]">{formatDate(note.updated_at_ms)}</time>
        </div>
        {note.children.length ? <div className="pl-7"><DocumentTree items={note.children} depth={depth + 1} activeNoteId={activeNoteId} canEdit={canEdit} main onNavigate={onNavigate} onCreateChild={onCreateChild} onRename={onRename} onArchive={onArchive} onMove={onMove} /></div> : null}
      </div>
    ));
  }

  return items.map((note, index) => (
    <div key={note.id} className="document-context-item" style={{ paddingLeft: `${12 + depth * 16}px` }}>
      <div className="flex min-w-0 items-center gap-1">
        <Link
          to={`/documents/${note.id}`}
          aria-current={note.id === activeNoteId ? "page" : undefined}
          className={`document-context-link ${note.id === activeNoteId ? "is-active" : ""}`}
          onClick={onNavigate}
        >
          <FilePlus2 aria-hidden="true" size={13} />
          <span className="truncate">{note.title}</span>
        </Link>
        {canEdit ? (
          <div className="document-context-actions">
            <button type="button" className="icon-button" aria-label={`上移 ${note.title}`} onClick={() => onMove(note, -1)} disabled={index === 0}><ArrowUp aria-hidden="true" size={13} /></button>
            <button type="button" className="icon-button" aria-label={`下移 ${note.title}`} onClick={() => onMove(note, 1)} disabled={index === items.length - 1}><ArrowDown aria-hidden="true" size={13} /></button>
            <button type="button" className="icon-button" aria-label={`新建子文档 ${note.title}`} onClick={() => onCreateChild(note.id)}><Plus aria-hidden="true" size={13} /></button>
            <button type="button" className="icon-button" aria-label={`重命名 ${note.title}`} onClick={() => onRename(note)}><MoreHorizontal aria-hidden="true" size={13} /></button>
            <button type="button" className="icon-button danger-hover" aria-label={`归档 ${note.title}`} onClick={() => onArchive(note)}><Archive aria-hidden="true" size={13} /></button>
          </div>
        ) : null}
      </div>
      {note.children.length ? <DocumentTree items={note.children} depth={depth + 1} activeNoteId={activeNoteId} canEdit={canEdit} onNavigate={onNavigate} onCreateChild={onCreateChild} onRename={onRename} onArchive={onArchive} onMove={onMove} /> : null}
    </div>
  ));
}

export function DocumentContextPanel({ notebookId, activeNoteId, mobile = false, onNavigate, variant = "side" }: DocumentContextPanelProps) {
  const navigate = useNavigate();
  const summaryContext = useContext(DocumentContextSummaryContext);
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const treeQuery = useNoteTree(notebookId);
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const archiveNote = useArchiveNote();
  const [createParent, setCreateParent] = useState<string | null | undefined>(undefined);
  const [renameTarget, setRenameTarget] = useState<NoteTreeItem | null>(null);
  const [undoNote, setUndoNote] = useState<NoteTreeItem | null>(null);
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
    setUndoNote(note);
    if (note.id === activeNoteId) navigate(`/collections/${notebookId}`, { replace: true });
  }

  async function handleUndo() {
    if (!undoNote) return;
    await archiveNote.mutateAsync({ id: undoNote.id, archived: false });
    setUndoNote(null);
  }

  async function handleMove(note: NoteTreeItem, delta: -1 | 1) {
    await updateNote.mutateAsync({ id: note.id, sort_order: Math.max(0, note.sort_order + delta) });
  }

  return (
    <section className={main ? "document-main-list" : "document-context"} aria-label="文档目录">
      {main ? null : (
        <div className="document-context-header">
          <h2>文档目录</h2>
          {canEdit ? <Button variant="ghost" className="document-context-create" icon={<Plus aria-hidden="true" size={14} />} onClick={() => setCreateParent(null)}>新建文档</Button> : null}
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
      {!treeQuery.isLoading && !treeQuery.isError ? <nav className={main ? "grid gap-0.5" : "document-context-tree"} aria-label="笔记本文档"><DocumentTree items={treeItems} depth={0} activeNoteId={activeNoteId} canEdit={canEdit} main={main} onNavigate={mobile ? onNavigate : undefined} onCreateChild={setCreateParent} onRename={setRenameTarget} onArchive={(note) => void handleArchive(note)} onMove={(note, delta) => void handleMove(note, delta)} /></nav> : null}
      <ResourceDialog open={createParent !== undefined} title={createParent ? "新建子文档" : "新建文档"} label="文档标题" placeholder="未命名文档" submitLabel="创建并打开" pending={createNote.isPending} onClose={() => setCreateParent(undefined)} onSubmit={handleCreate} />
      <ResourceDialog open={Boolean(renameTarget)} title="重命名文档" label="文档标题" placeholder="文档标题" initialValue={renameTarget?.title ?? ""} submitLabel="保存" pending={updateNote.isPending} onClose={() => setRenameTarget(null)} onSubmit={handleRename} />
      {undoNote ? <div className="toast"><div><div className="text-sm font-semibold">文档已归档</div><div className="mt-0.5 text-xs text-[var(--text-oninverse)] opacity-60">{undoNote.title}</div></div><button type="button" className="toast-action" onClick={() => void handleUndo()}><Undo2 aria-hidden="true" size={14} />撤销</button></div> : null}
    </section>
  );
}
