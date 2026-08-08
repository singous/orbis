import { Archive, ArrowDown, ArrowLeft, ArrowUp, BookOpen, Download, FilePlus2, Import, MoreHorizontal, Plus, Undo2 } from "lucide-react";
import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "zustand";

import type { NoteTreeItem } from "../../shared/api/schemas";
import { authStore } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { DocumentShell } from "./DocumentShell";
import { ResourceDialog } from "./ResourceDialog";
import {
  useArchiveNote,
  useCreateNote,
  useExportMarkdown,
  useImportMarkdown,
  useNotebooks,
  useNoteTree,
  useUpdateNote,
} from "./queries";

type FlatNote = NoteTreeItem & { depth: number };

function flattenTree(items: NoteTreeItem[], depth = 0): FlatNote[] {
  return items.flatMap((item) => [{ ...item, depth }, ...flattenTree(item.children, depth + 1)]);
}

export function NotebookPage() {
  const { collectionId = "" } = useParams();
  const navigate = useNavigate();
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = workspace?.role !== "normal";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const notebooksQuery = useNotebooks();
  const treeQuery = useNoteTree(collectionId);
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const archiveNote = useArchiveNote();
  const importMarkdown = useImportMarkdown();
  const exportMarkdown = useExportMarkdown();
  const [createParent, setCreateParent] = useState<string | null | undefined>(undefined);
  const [renameTarget, setRenameTarget] = useState<FlatNote | null>(null);
  const [undoNote, setUndoNote] = useState<FlatNote | null>(null);
  const notebook = notebooksQuery.data?.items.find((item) => item.id === collectionId);
  const flatNotes = useMemo(() => flattenTree(treeQuery.data?.items ?? []), [treeQuery.data?.items]);

  async function handleCreate(title: string) {
    const siblings = flatNotes.filter((item) => item.parent_id === (createParent ?? null));
    const note = await createNote.mutateAsync({ notebook_id: collectionId, title, parent_id: createParent ?? null, sort_order: siblings.length });
    setCreateParent(undefined);
    navigate(`/documents/${note.id}`);
  }

  async function handleRename(title: string) {
    if (!renameTarget) return;
    await updateNote.mutateAsync({ id: renameTarget.id, title });
    setRenameTarget(null);
  }

  async function handleArchive(note: FlatNote) {
    await archiveNote.mutateAsync({ id: note.id, archived: true });
    setUndoNote(note);
  }

  async function handleUndo() {
    if (!undoNote) return;
    await archiveNote.mutateAsync({ id: undoNote.id, archived: false });
    setUndoNote(null);
  }

  async function move(note: FlatNote, delta: -1 | 1) {
    await updateNote.mutateAsync({ id: note.id, sort_order: Math.max(0, note.sort_order + delta) });
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const markdown = await file.text();
    const title = file.name.replace(/\.md$/i, "") || "导入文档";
    const note = await importMarkdown.mutateAsync({ notebook_id: collectionId, title, markdown, parent_id: null, sort_order: flatNotes.length });
    navigate(`/documents/${note.id}`);
  }

  async function exportAllVisible() {
    for (const note of flatNotes) {
      const result = await exportMarkdown.mutateAsync(note.id);
      const url = URL.createObjectURL(new Blob([result.markdown], { type: "text/markdown;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    }
  }

  if (!notebooksQuery.isLoading && !notebook) {
    return <DocumentShell><div className="mx-auto max-w-3xl p-8"><StatusMessage tone="error" title="文集不存在">它可能已归档，或你没有访问权限。</StatusMessage><Link to="/documents" className="mt-4 inline-flex text-sm font-semibold">返回文档中心</Link></div></DocumentShell>;
  }

  return (
    <DocumentShell activeNotebookId={collectionId} toolbar={canEdit ? <Button variant="primary" icon={<Plus aria-hidden="true" size={15} />} onClick={() => setCreateParent(null)}>新建文档</Button> : null}>
      <div className="mx-auto max-w-[1040px] px-5 py-8 lg:px-10 lg:py-10">
        <Link to="/documents" className="mb-8 inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)] hover:text-black"><ArrowLeft aria-hidden="true" size={14} />文档中心</Link>
        <header className="notebook-hero">
          <div className="document-icon large"><BookOpen aria-hidden="true" size={25} /></div>
          <div className="min-w-0 flex-1"><div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-light)]">Collection</div><h1 className="truncate text-4xl font-semibold tracking-[-0.045em] lg:text-5xl">{notebook?.title ?? "正在加载…"}</h1><p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--muted)]">集中管理这个文集里的章节与页面。子文档会继承清晰的层级，但内容始终独立保存。</p><div className="mt-5 flex flex-wrap gap-2"><span className="tag">{flatNotes.length} 篇文档</span><span className="tag">结构化内容</span><span className="tag">自动保存</span></div></div>
        </header>

        <div className="mb-5 mt-10 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold tracking-[-0.02em]">文档目录</h2><p className="mt-1 text-xs text-[var(--muted)]">创建子页，形成多层内容结构</p></div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileInputRef} className="hidden" type="file" accept=".md,text/markdown,text/plain" onChange={handleImport} />
            {canEdit ? <Button variant="secondary" icon={<Import aria-hidden="true" size={14} />} onClick={() => fileInputRef.current?.click()} disabled={importMarkdown.isPending}>导入 Markdown</Button> : null}
            <Button variant="secondary" icon={<Download aria-hidden="true" size={14} />} onClick={exportAllVisible} disabled={!flatNotes.length || exportMarkdown.isPending}>导出全部</Button>
          </div>
        </div>

        {treeQuery.isError ? <StatusMessage tone="error" title="目录加载失败">请刷新页面后重试。</StatusMessage> : null}
        {treeQuery.isLoading ? <div className="empty-panel">正在加载文档目录…</div> : null}
        {!treeQuery.isLoading && !flatNotes.length ? <div className="empty-panel py-16"><FilePlus2 aria-hidden="true" className="mx-auto mb-3" size={26} /><div className="font-semibold text-black">从第一篇文档开始</div><p className="mt-1">可以直接写作，也可以导入已有 Markdown。</p>{canEdit ? <Button className="mt-5" variant="primary" onClick={() => setCreateParent(null)}>创建文档</Button> : null}</div> : null}

        {flatNotes.length ? <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[0_8px_30px_rgba(15,15,15,0.03)]">{flatNotes.map((note, index) => (
          <div key={note.id} className="group flex items-center gap-3 border-b border-[var(--border)] px-3 py-3 last:border-b-0 hover:bg-[#fafafa]" style={{ paddingLeft: `${12 + note.depth * 22}px` }}>
            <Link to={`/documents/${note.id}`} className="flex min-w-0 flex-1 items-center gap-3"><div className="document-icon small"><FilePlus2 aria-hidden="true" size={14} /></div><div className="min-w-0"><div className="truncate text-sm font-semibold">{note.title}</div><div className="mt-1 text-[11px] text-[var(--muted-light)]">{note.children.length} 个子页 · {new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(note.updated_at_ms))}</div></div></Link>
            {canEdit ? <div className="flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100"><button type="button" className="icon-button" aria-label={`上移 ${note.title}`} onClick={() => move(note, -1)} disabled={index === 0}><ArrowUp aria-hidden="true" size={14} /></button><button type="button" className="icon-button" aria-label={`下移 ${note.title}`} onClick={() => move(note, 1)} disabled={index === flatNotes.length - 1}><ArrowDown aria-hidden="true" size={14} /></button><button type="button" className="icon-button" aria-label={`在 ${note.title} 下新建子文档`} onClick={() => setCreateParent(note.id)}><Plus aria-hidden="true" size={14} /></button><button type="button" className="icon-button" aria-label={`重命名 ${note.title}`} onClick={() => setRenameTarget(note)}><MoreHorizontal aria-hidden="true" size={14} /></button><button type="button" className="icon-button danger-hover" aria-label={`归档 ${note.title}`} onClick={() => handleArchive(note)}><Archive aria-hidden="true" size={14} /></button></div> : null}
          </div>
        ))}</div> : null}
      </div>

      <ResourceDialog open={createParent !== undefined} title={createParent ? "新建子文档" : "新建文档"} label="文档标题" placeholder="未命名文档" submitLabel="创建并打开" pending={createNote.isPending} onClose={() => setCreateParent(undefined)} onSubmit={handleCreate} />
      <ResourceDialog open={Boolean(renameTarget)} title="重命名文档" label="文档标题" placeholder="文档标题" initialValue={renameTarget?.title ?? ""} submitLabel="保存" pending={updateNote.isPending} onClose={() => setRenameTarget(null)} onSubmit={handleRename} />
      {undoNote ? <div className="toast"><div><div className="text-sm font-semibold">文档已归档</div><div className="mt-0.5 text-xs text-white/60">{undoNote.title}</div></div><button type="button" className="toast-action" onClick={handleUndo}><Undo2 aria-hidden="true" size={14} />撤销</button></div> : null}
    </DocumentShell>
  );
}
