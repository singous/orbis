import { AlertTriangle, Archive, ArrowLeft, Check, Cloud, Download, Eye, EyeOff, RefreshCw, RotateCcw, Save, WifiOff } from "lucide-react";
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "zustand";

import { authStore } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { toV2, v2ToMarkdown, type NoteBlocksV2, type OrbisBlock, type OrbisInline } from "../notes/block-model";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { AutosaveCoordinator, type AutosaveState } from "./autosave";
import { DocumentShell } from "./DocumentShell";
import { NotebookSectionMenu } from "./NotebookSectionMenu";

// BlockNote is heavy; load it only when the editor page renders.
const BlockNoteEditor = lazy(() =>
  import("../notes/BlockNoteEditor").then((m) => ({ default: m.BlockNoteEditor })),
);
import {
  useArchiveNote,
  useNote,
  useNoteContent,
  useSaveNoteContent,
  useUpdateNote,
} from "./queries";
import { isUnavailableResourceError } from "./resource-errors";

type EditorDraft = { title: string; blocks: NoteBlocksV2; version: number };

function draftFingerprint(draft: EditorDraft): string {
  return JSON.stringify([draft.title.trim(), draft.blocks]);
}

function inlineText(inline: OrbisInline): string {
  return inline.type === "text" ? inline.text : inline.content.map(inlineText).join("");
}

function blockText(block: OrbisBlock): string {
  return typeof block.content === "string" ? block.content : block.content.map(inlineText).join("");
}

function outlineFromBlocks(blocks: NoteBlocksV2) {
  return blocks.blocks
    .filter((block) => block.type === "heading")
    .map((block, index) => ({
      id: `${index}-${blockText(block)}`,
      level: Number(block.props.level ?? 1),
      text: blockText(block) || "未命名标题",
    }));
}

const saveStateCopy: Record<AutosaveState, { label: string; icon: typeof Save }> = {
  saved: { label: "已保存", icon: Check },
  dirty: { label: "等待保存", icon: Cloud },
  saving: { label: "保存中…", icon: RefreshCw },
  error: { label: "保存失败", icon: WifiOff },
  conflict: { label: "版本冲突", icon: AlertTriangle },
};

class EditorErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <StatusMessage tone="error" title="编辑器加载失败">
          文档内容暂时无法以块编辑器打开。请刷新重试，或返回文档中心。
        </StatusMessage>
      );
    }
    return this.props.children;
  }
}

export function DocumentEditorPage() {
  const { noteId = "" } = useParams();
  const navigate = useNavigate();
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const noteQuery = useNote(noteId);
  const contentQuery = useNoteContent(noteId);
  const updateNote = useUpdateNote();
  const saveContent = useSaveNoteContent();
  const archiveNote = useArchiveNote();
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [saveState, setSaveState] = useState<AutosaveState>("saved");
  const [outlinePinned, setOutlinePinned] = useState(false);
  const [outlineHovered, setOutlineHovered] = useState(false);
  const coordinatorRef = useRef<AutosaveCoordinator<EditorDraft> | null>(null);
  const hydratedNoteRef = useRef<string | null>(null);
  const outlineOpen = outlinePinned || outlineHovered;

  useEffect(() => {
    const note = noteQuery.data;
    const content = contentQuery.data;
    if (!note || !content) return;
    // The version can only move forward per note, so a cached version at or
    // below what we last saved is either our own echo (setQueryData after
    // flush) or a stale query response that arrived late. Rebuilding the
    // draft from either would stomp the live editor (cursor loss, flicker,
    // lost keystrokes). Only a strictly newer server version — a genuine
    // external edit — warrants a rebuild.
    const saved = coordinatorRef.current?.saved;
    const isOwnOrStaleEcho =
      hydratedNoteRef.current === noteId &&
      saved != null &&
      content.content_version <= saved.version;
    if (isOwnOrStaleEcho) return;
    hydratedNoteRef.current = noteId;
    const initial = { title: note.title, blocks: toV2(content.blocks), version: content.content_version };
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
    // Force the hydrate effect to rebuild even if the version is unchanged.
    hydratedNoteRef.current = null;
    coordinatorRef.current?.dispose(false);
    await Promise.all([noteQuery.refetch(), contentQuery.refetch()]);
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
      {canEdit ? <button type="button" className="icon-button danger-hover" aria-label="归档文档" onClick={handleArchive}><Archive aria-hidden="true" size={15} /></button> : null}
    </div>
  );

  return (
    <DocumentShell toolbar={toolbar} sectionMenu={noteQuery.data ? <NotebookSectionMenu notebookId={noteQuery.data.notebook_id} activeNoteId={noteId} /> : undefined}>
      {!draft || !noteQuery.data ? <div className="grid min-h-[70vh] place-items-center text-sm text-[var(--muted)]">正在打开文档…</div> : (
        <div className={`editor-layout${outlineOpen ? " outline-open" : ""}`}>
          <article className="editor-canvas">
            <Link to={`/collections/${noteQuery.data.notebook_id}`} className="mb-7 inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)] hover:text-black"><ArrowLeft aria-hidden="true" size={14} />返回笔记本</Link>
            <input
              aria-label="文档标题"
              className="editor-title"
              placeholder="无标题"
              value={draft.title}
              readOnly={!canEdit}
              onChange={(event) => changeDraft({ ...draft, title: event.target.value })}
            />
            <div className="mb-7 mt-2 flex items-center gap-2 text-[11px] text-[var(--muted-light)]"><span>版本 {coordinatorRef.current?.saved?.version ?? draft.version}</span><span>·</span><span>{canEdit ? "750ms 自动保存" : "只读访问"}</span></div>

            {saveState === "conflict" ? <div className="mb-5"><StatusMessage tone="warning" title="检测到其他窗口的更新">本地草稿仍保留。建议先复制本地 Markdown，再载入服务端版本。
              <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" icon={<Download aria-hidden="true" size={14} />} onClick={() => navigator.clipboard?.writeText(v2ToMarkdown(draft.blocks.blocks))}>复制本地 Markdown</Button><Button variant="secondary" icon={<RotateCcw aria-hidden="true" size={14} />} onClick={reloadServer}>载入服务端版本</Button></div>
            </StatusMessage></div> : null}
            {saveState === "error" ? <div className="mb-5"><StatusMessage tone="error" title="自动保存失败">网络恢复后可手动重试，本地草稿不会丢失。<div className="mt-3"><Button variant="secondary" icon={<RefreshCw aria-hidden="true" size={14} />} onClick={() => coordinatorRef.current?.retry()}>重试保存</Button></div></StatusMessage></div> : null}

            <EditorErrorBoundary key={noteId}>
              <Suspense fallback={<div className="grid min-h-[40vh] place-items-center text-sm text-[var(--muted)]">正在加载编辑器…</div>}>
                <BlockNoteEditor
                  blocks={draft.blocks}
                  readOnly={!canEdit}
                  onChange={({ blocks }) => changeDraft({ ...draft, blocks })}
                />
              </Suspense>
            </EditorErrorBoundary>
          </article>
          <aside
            className="editor-outline"
            aria-label="文档大纲"
            onMouseEnter={() => setOutlineHovered(true)}
            onMouseLeave={() => setOutlineHovered(false)}
          >
            <button
              type="button"
              className="editor-outline-pin"
              aria-label={outlinePinned ? "取消大纲常驻" : "大纲常驻"}
              aria-pressed={outlinePinned}
              title={outlinePinned ? "取消常驻" : "常驻大纲"}
              onClick={() => setOutlinePinned((v) => !v)}
            >
              {outlinePinned ? <Eye aria-hidden="true" size={14} /> : <EyeOff aria-hidden="true" size={14} />}
            </button>
            <div className="editor-outline-body">
              <div className="mb-4 text-xs font-semibold text-[var(--muted)]">大纲</div>
              {outline.length ? <nav className="space-y-1">{outline.map((item) => <div key={item.id} className="truncate rounded-md py-1.5 text-xs text-[var(--muted)]" style={{ paddingLeft: `${(item.level - 1) * 10}px` }}>{item.text}</div>)}</nav> : <p className="text-xs leading-5 text-[var(--muted-light)]">添加标题后，这里会自动生成大纲。</p>}
            </div>
          </aside>
        </div>
      )}
    </DocumentShell>
  );
}
