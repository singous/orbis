import { AlertTriangle, Archive, ArrowLeft, Check, Cloud, Download, RefreshCw, RotateCcw, Save, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "zustand";

import type { NoteBlocks } from "../../shared/api/schemas";
import { authStore } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { TiptapNoteEditor } from "../notes/TiptapNoteEditor";
import { tiptapDocToMarkdown } from "../notes/markdown-contract";
import type { TiptapDocument } from "../notes/note-contract";
import { AutosaveCoordinator, type AutosaveState } from "./autosave";
import { DocumentContextPanel } from "./DocumentContextPanel";
import { DocumentShell } from "./DocumentShell";
import {
  useArchiveNote,
  useExportMarkdown,
  useNote,
  useNoteContent,
  useSaveNoteContent,
  useUpdateNote,
} from "./queries";
import { isUnavailableResourceError } from "./resource-errors";

type EditorDraft = { title: string; blocks: NoteBlocks; version: number };

function draftFingerprint(draft: EditorDraft): string {
  return JSON.stringify([draft.title.trim(), draft.blocks]);
}

function outlineFromBlocks(blocks: NoteBlocks) {
  const nodes = (blocks.doc.content ?? []) as Array<{ type?: string; attrs?: { level?: number }; content?: Array<{ text?: string }> }>;
  return nodes
    .filter((node) => node.type === "heading")
    .map((node, index) => ({ id: `${index}-${node.content?.map((child) => child.text ?? "").join("")}`, level: node.attrs?.level ?? 1, text: node.content?.map((child) => child.text ?? "").join("") || "未命名标题" }));
}

const saveStateCopy: Record<AutosaveState, { label: string; icon: typeof Save }> = {
  saved: { label: "已保存", icon: Check },
  dirty: { label: "等待保存", icon: Cloud },
  saving: { label: "保存中…", icon: RefreshCw },
  error: { label: "保存失败", icon: WifiOff },
  conflict: { label: "版本冲突", icon: AlertTriangle },
};

export function DocumentEditorPage() {
  const { noteId = "" } = useParams();
  const navigate = useNavigate();
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = workspace?.role !== "normal";
  const noteQuery = useNote(noteId);
  const contentQuery = useNoteContent(noteId);
  const updateNote = useUpdateNote();
  const saveContent = useSaveNoteContent();
  const archiveNote = useArchiveNote();
  const exportMarkdown = useExportMarkdown();
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [saveState, setSaveState] = useState<AutosaveState>("saved");
  const coordinatorRef = useRef<AutosaveCoordinator<EditorDraft> | null>(null);

  useEffect(() => {
    const note = noteQuery.data;
    const content = contentQuery.data;
    if (!note || !content) return;
    const initial = { title: note.title, blocks: content.blocks, version: content.content_version };
    setDraft(initial);
    coordinatorRef.current?.dispose(false);
    const coordinator = new AutosaveCoordinator<EditorDraft>({
      delayMs: 750,
      fingerprint: draftFingerprint,
      onStateChange: setSaveState,
      save: async (current, saved) => {
        if (current.title.trim() !== saved.title.trim()) {
          await updateNote.mutateAsync({ id: noteId, title: current.title.trim() || "未命名文档" });
        }
        let version = saved.version;
        if (JSON.stringify(current.blocks) !== JSON.stringify(saved.blocks)) {
          const result = await saveContent.mutateAsync({ noteId, expectedVersion: saved.version, blocks: current.blocks });
          version = result.content_version;
        }
        return { ...current, title: current.title.trim() || "未命名文档", version };
      },
    });
    coordinator.hydrate(initial);
    coordinatorRef.current = coordinator;
    return () => coordinator.dispose(true);
  }, [contentQuery.data?.content_version, noteId, noteQuery.data?.title]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (coordinatorRef.current?.state === "dirty") {
        event.preventDefault();
        void coordinatorRef.current.flush();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const resourceUnavailable =
    isUnavailableResourceError(noteQuery.error) ||
    isUnavailableResourceError(contentQuery.error);

  useEffect(() => {
    if (!resourceUnavailable) return;
    navigate("/documents/collections", {
      replace: true,
      state: {
        resourceError: "无法打开文档：它不存在、已归档，或你没有访问权限。",
      },
    });
  }, [navigate, resourceUnavailable]);

  const outline = useMemo(() => draft ? outlineFromBlocks(draft.blocks) : [], [draft?.blocks]);
  const stateCopy = saveStateCopy[saveState];
  const StateIcon = stateCopy.icon;

  function changeDraft(next: EditorDraft) {
    setDraft(next);
    coordinatorRef.current?.change(next);
  }

  async function reloadServer() {
    coordinatorRef.current?.dispose(false);
    await Promise.all([noteQuery.refetch(), contentQuery.refetch()]);
  }

  async function downloadMarkdown() {
    const result = await exportMarkdown.mutateAsync(noteId);
    const url = URL.createObjectURL(new Blob([result.markdown], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleArchive() {
    if (!noteQuery.data) return;
    await archiveNote.mutateAsync({ id: noteId, archived: true });
    navigate(`/collections/${noteQuery.data.notebook_id}`, { replace: true });
  }

  if (noteQuery.isError || contentQuery.isError) {
    return <DocumentShell><div className="mx-auto max-w-3xl p-8"><StatusMessage tone="error" title="无法打开文档">文档可能已归档，或你没有访问权限。</StatusMessage><Link to="/documents" className="mt-4 inline-flex text-sm font-semibold">返回文档中心</Link></div></DocumentShell>;
  }

  const toolbar = (
    <div className="flex items-center gap-2">
      <span className={`save-indicator state-${saveState}`}><StateIcon aria-hidden="true" size={13} className={saveState === "saving" ? "animate-spin" : ""} />{stateCopy.label}</span>
      <Button variant="secondary" className="hidden sm:inline-flex" icon={<Download aria-hidden="true" size={14} />} onClick={downloadMarkdown} disabled={exportMarkdown.isPending}>Markdown</Button>
      {canEdit ? <button type="button" className="icon-button danger-hover" aria-label="归档文档" onClick={handleArchive}><Archive aria-hidden="true" size={15} /></button> : null}
    </div>
  );

  return (
    <DocumentShell toolbar={toolbar} contextPanel={noteQuery.data ? <DocumentContextPanel notebookId={noteQuery.data.notebook_id} activeNoteId={noteId} /> : undefined}>
      {!draft || !noteQuery.data ? <div className="grid min-h-[70vh] place-items-center text-sm text-[var(--muted)]">正在打开文档…</div> : (
        <div className="editor-layout">
          <article className="editor-canvas">
            <Link to={`/collections/${noteQuery.data.notebook_id}`} className="mb-7 inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)] hover:text-black"><ArrowLeft aria-hidden="true" size={14} />返回文集</Link>
            <input
              aria-label="文档标题"
              className="editor-title"
              value={draft.title}
              readOnly={!canEdit}
              onChange={(event) => changeDraft({ ...draft, title: event.target.value })}
            />
            <div className="mb-7 mt-2 flex items-center gap-2 text-[11px] text-[var(--muted-light)]"><span>版本 {coordinatorRef.current?.saved?.version ?? draft.version}</span><span>·</span><span>{canEdit ? "750ms 自动保存" : "只读访问"}</span></div>

            {saveState === "conflict" ? <div className="mb-5"><StatusMessage tone="warning" title="检测到其他窗口的更新">本地草稿仍保留。建议先复制本地 Markdown，再载入服务端版本。
              <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" icon={<Download aria-hidden="true" size={14} />} onClick={() => navigator.clipboard?.writeText(tiptapDocToMarkdown(draft.blocks.doc as TiptapDocument))}>复制本地 Markdown</Button><Button variant="secondary" icon={<RotateCcw aria-hidden="true" size={14} />} onClick={reloadServer}>载入服务端版本</Button></div>
            </StatusMessage></div> : null}
            {saveState === "error" ? <div className="mb-5"><StatusMessage tone="error" title="自动保存失败">网络恢复后可手动重试，本地草稿不会丢失。<div className="mt-3"><Button variant="secondary" icon={<RefreshCw aria-hidden="true" size={14} />} onClick={() => coordinatorRef.current?.retry()}>重试保存</Button></div></StatusMessage></div> : null}

            <TiptapNoteEditor
              blocks={draft.blocks}
              readOnly={!canEdit}
              onChange={({ blocks }) => changeDraft({ ...draft, blocks })}
            />
          </article>
          <aside className="editor-outline" aria-label="文档大纲">
            <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-light)]">On this page</div>
            {outline.length ? <nav className="space-y-1">{outline.map((item) => <div key={item.id} className="truncate rounded-md py-1.5 text-xs text-[var(--muted)]" style={{ paddingLeft: `${(item.level - 1) * 10}px` }}>{item.text}</div>)}</nav> : <p className="text-xs leading-5 text-[var(--muted-light)]">添加标题后，这里会自动生成大纲。</p>}
          </aside>
        </div>
      )}
    </DocumentShell>
  );
}
