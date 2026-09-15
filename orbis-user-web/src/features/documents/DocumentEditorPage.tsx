import { AlertTriangle, Archive, ArrowLeft, Check, Cloud, Download, Eye, EyeOff, MessageSquare, RefreshCw, RotateCcw, Save, WifiOff } from "lucide-react";
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore } from "zustand";

import { ApiError } from "../../shared/api/api-client";
import { authStore } from "../../shared/auth/auth-store";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { extractPlainTextV2, toV2, v2ToMarkdown, type NoteBlocksV2 } from "../notes/block-model";
import type { RestoreSavedRevision } from "../collaboration/DocumentCollaborationPanel";
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

const DocumentCollaborationPanel = lazy(() =>
  import("../collaboration/DocumentCollaborationPanel").then((module) => ({ default: module.DocumentCollaborationPanel })),
);

type EditorDraft = { title: string; blocks: NoteBlocksV2; version: number };

function draftFingerprint(draft: EditorDraft): string {
  return JSON.stringify([draft.title.trim(), draft.blocks]);
}

function outlineFromBlocks(blocks: NoteBlocksV2) {
  return blocks.blocks
    .filter((block) => block.type === "heading")
    .map((block, index) => {
      const text = extractPlainTextV2([{ ...block, children: [] }]);
      return { id: `${index}-${text}`, level: Number(block.props.level ?? 1), text: text || "未命名标题" };
    });
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
  const currentUserId = useStore(authStore, (state) => state.user?.id ?? "");
  const noteQuery = useNote(noteId);
  const contentQuery = useNoteContent(noteId);
  const updateNote = useUpdateNote();
  const saveContent = useSaveNoteContent();
  const archiveNote = useArchiveNote();
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [autosaveState, setSaveState] = useState<AutosaveState>("saved");
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restorationConflict, setRestorationConflict] = useState(false);
  const restoringRef = useRef(false);
  const collaborationTriggerRef = useRef<HTMLButtonElement>(null);
  const saveState = restorationConflict ? "conflict" : autosaveState;
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
    const existing = coordinatorRef.current;
    const saved = existing?.saved;
    // A cache refresh must never replace unsaved work or an active restoration.
    if (hydratedNoteRef.current === noteId && existing && (restoringRef.current || existing.state !== "saved")) return;
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
      // Bursts separated by short pauses coalesce into at most one save per
      // 2s; continuous typing without a pause is capped at 15s so a crash
      // cannot lose more than that window.
      minIntervalMs: 2_000,
      maxDelayMs: 15_000,
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
  }, [contentQuery.data?.content_version, noteId, noteQuery.data?.title]);

  useEffect(() => () => {
    const coordinator = coordinatorRef.current;
    coordinator?.dispose(canEdit && (coordinator.state === "dirty" || coordinator.state === "saving"));
    coordinatorRef.current = null;
    hydratedNoteRef.current = null;
  }, [noteId]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if ((coordinatorRef.current && coordinatorRef.current.state !== "saved") || restoringRef.current) {
        event.preventDefault();
        if (coordinatorRef.current?.state === "dirty") void coordinatorRef.current.flush();
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
    if (!canEdit || restoringRef.current) return;
    setDraft(next);
    coordinatorRef.current?.change(next);
  }

  async function reloadServer() {
    // Explicitly replace the draft only after both server reads succeed.
    const coordinator = coordinatorRef.current;
    coordinator?.dispose(false);
    const [noteResult, contentResult] = await Promise.all([noteQuery.refetch(), contentQuery.refetch()]);
    if (coordinatorRef.current !== coordinator || !noteResult.data || !contentResult.data || noteResult.error || contentResult.error) return;
    const next = { title: noteResult.data.title, blocks: toV2(contentResult.data.blocks), version: contentResult.data.content_version };
    coordinatorRef.current?.hydrate(next);
    setDraft(next);
    setRestorationConflict(false);
  }

  async function restoreSavedRevision(restore: RestoreSavedRevision) {
    const coordinator = coordinatorRef.current;
    if (!canEdit || !coordinator || restoringRef.current) throw new Error("当前无法恢复文档。");
    if (restorationConflict || ["conflict", "error"].includes(coordinator.state)) {
      throw new Error("请先关闭面板，处理保存失败或版本冲突，再恢复历史。本地草稿仍保留。");
    }
    restoringRef.current = true;
    setRestoring(true);
    try {
      await coordinator.flush();
      if (coordinatorRef.current !== coordinator) throw new Error("文档已切换，请在当前文档中重新选择历史版本。");
      const saved = coordinator.saved;
      if (coordinator.state !== "saved" || !saved) {
        throw new Error("当前草稿尚未成功保存。请先处理保存失败或版本冲突，本地草稿仍保留。");
      }
      const restored = await restore(saved.version);
      if (coordinatorRef.current !== coordinator) return;
      const next = { ...saved, blocks: toV2(restored.blocks), version: restored.content_version };
      coordinator.hydrate(next);
      setDraft(next);
      setRestorationConflict(false);
    } catch (error) {
      if (coordinatorRef.current === coordinator && error instanceof ApiError && error.isConflict) setRestorationConflict(true);
      throw error;
    } finally {
      restoringRef.current = false;
      setRestoring(false);
    }
  }

  function closeCollaboration() {
    if (restoringRef.current) return;
    setCollaborationOpen(false);
    collaborationTriggerRef.current?.focus();
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
      <button ref={collaborationTriggerRef} type="button" className="icon-button" aria-label="评论与历史" aria-haspopup="dialog" aria-expanded={collaborationOpen} disabled={!draft} onClick={() => setCollaborationOpen(true)}><MessageSquare aria-hidden="true" size={16} /></button>
      <span className={`save-indicator state-${saveState}`}><StateIcon aria-hidden="true" size={13} className={saveState === "saving" ? "animate-spin" : ""} />{stateCopy.label}</span>
      {canEdit ? <button type="button" className="icon-button danger-hover" aria-label="归档文档" disabled={restoring} onClick={handleArchive}><Archive aria-hidden="true" size={15} /></button> : null}
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
              readOnly={!canEdit || restoring}
              onChange={(event) => changeDraft({ ...draft, title: event.target.value })}
            />
            <div className="mb-7 mt-2 flex items-center gap-2 text-[11px] text-[var(--muted-light)]"><span>版本 {coordinatorRef.current?.saved?.version ?? draft.version}</span><span>·</span><span>{canEdit ? "停手后自动保存" : "只读访问"}</span></div>

            {saveState === "conflict" ? <div className="mb-5"><StatusMessage tone="warning" title="检测到其他窗口的更新">本地草稿仍保留。建议先复制本地 Markdown，再载入服务端版本。
              <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" icon={<Download aria-hidden="true" size={14} />} onClick={() => navigator.clipboard?.writeText(v2ToMarkdown(draft.blocks.blocks))}>复制本地 Markdown</Button><Button variant="secondary" icon={<RotateCcw aria-hidden="true" size={14} />} onClick={reloadServer}>载入服务端版本</Button></div>
            </StatusMessage></div> : null}
            {saveState === "error" ? <div className="mb-5"><StatusMessage tone="error" title="自动保存失败">网络恢复后可手动重试，本地草稿不会丢失。<div className="mt-3"><Button variant="secondary" icon={<RefreshCw aria-hidden="true" size={14} />} onClick={() => coordinatorRef.current?.retry()}>重试保存</Button></div></StatusMessage></div> : null}

            <EditorErrorBoundary key={noteId}>
              <Suspense fallback={<div className="grid min-h-[40vh] place-items-center text-sm text-[var(--muted)]">正在加载编辑器…</div>}>
                <BlockNoteEditor
                  blocks={draft.blocks}
                  readOnly={!canEdit || restoring}
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
      {collaborationOpen ? <Suspense fallback={<p role="status">正在加载评论与历史…</p>}><DocumentCollaborationPanel key={noteId} noteId={noteId} currentUserId={currentUserId} canManage={canEdit} onClose={closeCollaboration} onRestore={restoreSavedRevision} /></Suspense> : null}
    </DocumentShell>
  );
}
