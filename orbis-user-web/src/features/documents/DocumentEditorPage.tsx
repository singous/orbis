import { LoadingState } from "../../shared/ui/LoadingState";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { Input as HeroInput } from "@heroui/react/input";
import { ActionButton } from "../../shared/ui/ActionButton";
import { AlertTriangle, Archive, BookOpen, ChevronRight, MoreHorizontal, Check, Cloud, Download, MessageSquare, RefreshCw, RotateCcw, Save, WifiOff } from "../../shared/ui/icons";
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useStore } from "zustand";

import { ApiError } from "../../shared/api/api-client";
import { authStore } from "../../shared/auth/auth-store";
import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { registerPendingNavigation } from "../../shared/navigation/pending-navigation";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { v2ToMarkdown, type NoteBlocksV2 } from "../notes/block-model";
import type { RestoreSavedRevision } from "../collaboration/DocumentCollaborationPanel";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { AutosaveCoordinator, type AutosaveState } from "./autosave";
import { normalizeEditorBlocks } from "./editor-blocks";
import { createEditorDraftFingerprint, type EditorDraft } from "./editor-draft";
import { EditorLayout, EditorOutlineStore } from "./EditorLayout";
import { loadDocumentEditor } from "./editor-module";
import { DocumentShell } from "./DocumentShell";
import { getNoteContentPage, getNoteContentOutline } from "./api";
import { CONTENT_PAGE_SIZE, type EditorContentHandle } from "./editor-content-handle";

// Load the editor only on document pages; readers use the lightweight renderer.
const TiptapEditor = lazy(loadDocumentEditor);

function LiveDocumentEditor({ blocks, onChange, ...props }: {
  blocks: NoteBlocksV2;
  onChange: (next: { blocks: NoteBlocksV2 }) => void;
  onError: (message: string | null) => void;
  readOnly: boolean;
  noteId: string;
  onContentReady?: (handle: EditorContentHandle | null) => void;
  ensureComplete?: () => Promise<void>;
  hasMoreContent?: boolean;
}) {
  const [local, setLocal] = useState({ source: blocks, value: blocks });
  // A restored/server revision replaces local content before editability
  // changes reach the editor. Ordinary keystrokes only rerender this boundary.
  if (local.source !== blocks) setLocal({ source: blocks, value: blocks });
  return <TiptapEditor {...props} blocks={local.source === blocks ? local.value : blocks} onChange={next => {
    setLocal({ source: blocks, value: next.blocks });
    onChange(next);
  }} />;
}
import {
  useArchiveNote,
  useNotebook,
  useNote,
  useNoteContent,
  useSaveNoteContent,
  useUpdateNote,
} from "./queries";
import { isUnavailableResourceError } from "./resource-errors";

const DocumentCollaborationPanel = lazy(() =>
  import("../collaboration/DocumentCollaborationPanel").then((module) => ({ default: module.DocumentCollaborationPanel })),
);

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
          文档内容暂时无法在编辑器中打开。请刷新重试，或返回文档中心。
        </StatusMessage>
      );
    }
    return this.props.children;
  }
}

export function DocumentEditorPage() {
  const { noteId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const commentId = searchParams.get("comment");
  const outlineStore = useMemo(() => new EditorOutlineStore(), [noteId]);
  useEffect(() => { void loadDocumentEditor().catch(() => { /* The editor boundary reports module load failures. */ }); }, []);
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const currentUserId = useStore(authStore, (state) => state.user?.id ?? "");
  const noteQuery = useNote(noteId);
  const notebook = useNotebook(noteQuery.data?.notebook_id).data;
  const contentQuery = useNoteContent(noteId, { pageSize: CONTENT_PAGE_SIZE });
  const documentAuth = useOptionalAuthRequest();
  const updateNote = useUpdateNote();
  const saveContent = useSaveNoteContent();
  const archiveNote = useArchiveNote();
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const editorErrorRef = useRef<string | null>(null);
  const [autosaveState, setSaveState] = useState<AutosaveState>("saved");
  const [collaborationOpen, setCollaborationOpen] = useState(Boolean(commentId));
  useEffect(() => { setCollaborationOpen(Boolean(commentId)); }, [noteId, commentId]);
  const [restoring, setRestoring] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [restorationConflict, setRestorationConflict] = useState(false);
  const restoringRef = useRef(false);
  const archivingRef = useRef<AutosaveCoordinator<EditorDraft> | null>(null);
  const collaborationTriggerRef = useRef<HTMLButtonElement>(null);
  const saveState = editorError ? "error" : restorationConflict ? "conflict" : autosaveState;
  const coordinatorRef = useRef<AutosaveCoordinator<EditorDraft> | null>(null);
  const coordinatorMode = useRef<{ coordinator: AutosaveCoordinator<EditorDraft>; mode: { partial: boolean } } | null>(null);
  const hydratedNoteRef = useRef<string | null>(null);
  const editorBusy = restoring || archiving;
  const contentHandle = useRef<EditorContentHandle | null>(null);
  const contentWindow = useRef<{ noteId: string; version: number; next: number; total: number; hasMore: boolean } | null>(null);
  const contentAbort = useRef<AbortController | null>(null);
  const loadingRequest = useRef<Promise<void> | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [hasMoreContent, setHasMoreContent] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const loadMoreTarget = useRef<HTMLDivElement>(null);
  const navigationStateRef = useRef({ noteId, canEdit, restorationConflict });
  navigationStateRef.current = { noteId, canEdit, restorationConflict };

  useEffect(() => registerPendingNavigation(async () => {
    const coordinator = coordinatorRef.current;
    function assertReady() {
      const state = navigationStateRef.current;
      if (state.noteId !== noteId || coordinatorRef.current !== coordinator) {
        throw new DOMException("The current document changed", "AbortError");
      }
      if (editorErrorRef.current) throw new Error(editorErrorRef.current);
      if (restoringRef.current || archivingRef.current) throw new Error("当前文档正在恢复或归档，请完成后再打开其他内容。");
      if (state.restorationConflict || coordinator?.state === "conflict" || coordinator?.state === "error") {
        throw new Error("当前草稿尚未成功保存。请先处理保存失败或版本冲突，本地草稿仍保留。");
      }
      if (!state.canEdit && coordinator && coordinator.state !== "saved") {
        throw new Error("当前文档已变为只读，本地草稿尚未保存，请先处理后再打开其他内容。");
      }
    }
    assertReady();
    // A loading document has no editable local draft to flush.
    if (!coordinator || hydratedNoteRef.current !== noteId || !navigationStateRef.current.canEdit) return;
    await flushCurrentDraft(coordinator);
    assertReady();
  }), [noteId]);

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
    // A cache refresh must never replace unsaved work or an active operation.
    if (hydratedNoteRef.current === noteId && existing && (restoringRef.current || archivingRef.current || existing.state !== "saved")) return;
    const isOwnOrStaleEcho =
      hydratedNoteRef.current === noteId &&
      saved != null &&
      content.content_version <= saved.version;
    if (isOwnOrStaleEcho) return;
    hydratedNoteRef.current = noteId;
    const paged = "next_offset" in content;
    contentWindow.current = paged ? { noteId, version: content.content_version, next: content.next_offset, total: content.total_blocks, hasMore: content.has_more } : null;
    outlineStore.setRemote([], paged ? content.next_offset : Infinity);
    setHasMoreContent(paged && content.has_more);
    setLoadMoreError(null);
    const initial = { title: note.title, blocks: normalizeEditorBlocks(noteId, content.blocks), version: content.content_version };
    setDraft(initial);
    outlineStore.update(initial.blocks);
    coordinatorRef.current?.dispose(false);
    const fingerprint = createEditorDraftFingerprint();
    const mode = { partial: paged };
    const coordinator = new AutosaveCoordinator<EditorDraft>({
      delayMs: 750,
      // Bursts separated by short pauses coalesce into at most one save per
      // 2s; continuous typing without a pause is capped at 15s so a crash
      // cannot lose more than that window.
      minIntervalMs: 2_000,
      maxDelayMs: 15_000,
      fingerprint,
      onStateChange: setSaveState,
      save: async (current, saved) => {
        if (current.title.trim() !== saved.title.trim()) {
          await updateNote.mutateAsync({ id: noteId, title: current.title.trim() || "未命名文档" });
        }
        let version = saved.version;
        if (fingerprint({ ...current, title: "" }) !== fingerprint({ ...saved, title: "" })) {
          const result = await saveContent.mutateAsync({ noteId, expectedVersion: saved.version, blocks: current.blocks, ...(mode.partial ? { loadedBlockIds: saved.blocks.blocks.map(block => block.id) } : {}) });
          version = result.content_version;
        }
        return { ...current, title: current.title.trim() || "未命名文档", version };
      },
    });
    coordinator.hydrate(initial);
    coordinatorRef.current = coordinator;
    coordinatorMode.current = { coordinator, mode };
  }, [contentQuery.data?.content_version, noteId, noteQuery.data?.title]);

  useEffect(() => {
    setEditorError(null);
    editorErrorRef.current = null;
    setArchiving(false);
    setArchiveError(null);
    const abort = new AbortController();
    contentAbort.current = abort;
    return () => {
      abort.abort();
      contentHandle.current = null;
      contentWindow.current = null;
      loadingRequest.current = null;
      const coordinator = coordinatorRef.current;
      coordinator?.dispose(canEdit && (coordinator.state === "dirty" || coordinator.state === "saving"));
      coordinatorRef.current = null;
      hydratedNoteRef.current = null;
      archivingRef.current = null;
    };
  }, [noteId]);

  async function loadMoreContent(): Promise<void> {
    if (loadingRequest.current) return loadingRequest.current;
    const window = contentWindow.current;
    const coordinator = coordinatorRef.current;
    const handle = contentHandle.current;
    const abort = contentAbort.current;
    if (!window?.hasMore || window.noteId !== noteId || !coordinator || !handle || !abort) return;
    if (!documentAuth) throw new Error("请重新登录后继续读取文档。");
    setLoadingMore(true);
    setLoadMoreError(null);
    const task = (async () => {
      const page = await getNoteContentPage(noteId, documentAuth, { offset: window.next, limit: CONTENT_PAGE_SIZE, version: window.version, signal: abort.signal });
      if (!("next_offset" in page) || page.content_version !== window.version || page.offset !== window.next) throw new Error("后续正文的版本不一致，请重新载入文档。");
      await coordinator.settlePendingSave();
      if (abort.signal.aborted || coordinatorRef.current !== coordinator || contentWindow.current !== window || contentHandle.current !== handle) return;
      const addition = normalizeEditorBlocks(noteId, page.blocks).blocks;
      const wasSaved = coordinator.state === "saved";
      coordinator.extend(value => ({ ...value, blocks: { ...value.blocks, blocks: [...value.blocks.blocks, ...addition] } }));
      const live = handle.append(addition);
      const current = coordinator.current!;
      if (wasSaved) coordinator.hydrate({ ...current, blocks: live });
      else coordinator.alignCurrentAfterRead({ ...current, blocks: live });
      setDraft(coordinator.current);
      outlineStore.setBoundary(page.next_offset);
      outlineStore.update(live);
      window.next = page.next_offset;
      window.hasMore = page.has_more;
      setHasMoreContent(page.has_more);
    })();
    loadingRequest.current = task;
    try { await task; }
    catch (error) {
      if (!abort.signal.aborted && contentWindow.current === window) setLoadMoreError(error instanceof Error ? error.message : "后续正文加载失败，请重试。");
      throw error;
    } finally {
      if (loadingRequest.current === task) { loadingRequest.current = null; setLoadingMore(false); }
    }
  }

  async function loadCompleteContent(): Promise<void> {
    if (!contentHandle.current) throw new Error("正文尚未准备好，请稍后重试。");
    while (contentWindow.current?.noteId === noteId && contentWindow.current.hasMore) await loadMoreContent();
  }

  const loadMoreRef = useRef(loadMoreContent);
  loadMoreRef.current = loadMoreContent;
  useEffect(() => {
    const target = loadMoreTarget.current;
    if (!editorReady || !hasMoreContent || loadingMore || loadMoreError || !target) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMoreRef.current().catch(() => {});
    }, { root: target.closest(".document-scroll-region"), rootMargin: "320px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [editorReady, hasMoreContent, loadingMore, loadMoreError, noteId]);

  useEffect(() => {
    const window = contentWindow.current;
    if (!editorReady || !window?.hasMore || window.noteId !== noteId || !documentAuth) return;
    const abort = new AbortController();
    void getNoteContentOutline(noteId, window.version, documentAuth, abort.signal).then(outline => {
      if (!abort.signal.aborted && contentWindow.current === window) outlineStore.setRemote(outline.items, window.next);
    }).catch(() => { /* Loaded headings remain available when the index is offline. */ });
    return () => abort.abort();
  }, [editorReady, noteId, contentQuery.data?.content_version]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (editorErrorRef.current || (coordinatorRef.current && coordinatorRef.current.state !== "saved") || restoringRef.current || archivingRef.current) {
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

  const stateCopy = saveStateCopy[saveState];
  const StateIcon = stateCopy.icon;

  function changeDraft(next: EditorDraft) {
    if (!canEdit || restoringRef.current || archivingRef.current) return;
    // The live body belongs to ProseMirror and the save coordinator. Only
    // title changes need to refresh the workspace breadcrumb and outer shell.
    if (next.title !== draft?.title) setDraft(next);
    outlineStore.update(next.blocks);
    coordinatorRef.current?.change(next);
  }

  async function reloadServer() {
    if (restoringRef.current || archivingRef.current) return;
    // Explicitly replace the draft only after both server reads succeed.
    const coordinator = coordinatorRef.current;
    coordinator?.dispose(false);
    const [noteResult, contentResult] = await Promise.all([noteQuery.refetch(), contentQuery.refetch()]);
    if (coordinatorRef.current !== coordinator || !noteResult.data || !contentResult.data || noteResult.error || contentResult.error) return;
    const next = { title: noteResult.data.title, blocks: normalizeEditorBlocks(noteId, contentResult.data.blocks), version: contentResult.data.content_version };
    if (coordinatorMode.current?.coordinator === coordinator) coordinatorMode.current.mode.partial = "next_offset" in contentResult.data;
    const content = contentResult.data;
    contentWindow.current = "next_offset" in content ? { noteId, version: content.content_version, next: content.next_offset, total: content.total_blocks, hasMore: content.has_more } : null;
    setHasMoreContent(contentWindow.current?.hasMore ?? false);
    coordinatorRef.current?.hydrate(next);
    setDraft(next);
    outlineStore.update(next.blocks);
    setRestorationConflict(false);
  }

  async function flushCurrentDraft(coordinator: AutosaveCoordinator<EditorDraft>) {
    if (editorErrorRef.current) throw new Error(editorErrorRef.current);
    await coordinator.flush();
    if (coordinatorRef.current !== coordinator) throw new Error("文档已切换，请在当前文档中重新操作。");
    const saved = coordinator.saved;
    if (coordinator.state !== "saved" || !saved) {
      throw new Error("当前草稿尚未成功保存。请先处理保存失败或版本冲突，本地草稿仍保留。");
    }
    return saved;
  }

  async function restoreSavedRevision(restore: RestoreSavedRevision) {
    const coordinator = coordinatorRef.current;
    if (!canEdit || !coordinator || restoringRef.current || archivingRef.current) throw new Error("当前无法恢复文档。");
    if (restorationConflict || ["conflict", "error"].includes(coordinator.state)) {
      throw new Error("请先关闭面板，处理保存失败或版本冲突，再恢复历史。本地草稿仍保留。");
    }
    restoringRef.current = true;
    setRestoring(true);
    try {
      const saved = await flushCurrentDraft(coordinator);
      const restored = await restore(saved.version);
      if (coordinatorRef.current !== coordinator) return;
      const next = { ...saved, blocks: normalizeEditorBlocks(noteId, restored.blocks), version: restored.content_version };
      contentWindow.current = { noteId, version: restored.content_version, next: next.blocks.blocks.length, total: next.blocks.blocks.length, hasMore: false };
      setHasMoreContent(false);
      coordinator.hydrate(next);
      setDraft(next);
      outlineStore.update(next.blocks);
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
    const coordinator = coordinatorRef.current;
    const note = noteQuery.data;
    if (!canEdit || !note || !coordinator || restoringRef.current || archivingRef.current) return;
    if (restorationConflict || ["conflict", "error"].includes(coordinator.state)) {
      setArchiveError("请先处理保存失败或版本冲突，再归档文档。本地草稿仍保留。");
      return;
    }
    archivingRef.current = coordinator;
    setArchiving(true);
    setArchiveError(null);
    try {
      await flushCurrentDraft(coordinator);
      await archiveNote.mutateAsync({ id: noteId, archived: true });
      if (coordinatorRef.current === coordinator) navigate(`/collections/${note.notebook_id}`, { replace: true });
    } catch (error) {
      if (coordinatorRef.current === coordinator) {
        setArchiveError(error instanceof Error ? error.message : "归档失败，请重试。本地草稿仍保留。");
      }
    } finally {
      if (archivingRef.current === coordinator) {
        archivingRef.current = null;
        if (coordinatorRef.current === coordinator) setArchiving(false);
      }
    }
  }

  if (noteQuery.isError || contentQuery.isError) {
    return <DocumentShell><div className="mx-auto max-w-3xl p-8"><StatusMessage tone="error" title="无法打开文档">文档可能已归档，或你没有访问权限。</StatusMessage><Link to="/documents" className="mt-4 inline-flex text-sm font-semibold">返回文档中心</Link></div></DocumentShell>;
  }

  const breadcrumb = (
    <nav className="document-breadcrumb" aria-label="文档位置">
      <Link to={noteQuery.data ? `/collections/${noteQuery.data.notebook_id}` : "/documents"} title={notebook?.title ?? "笔记本"}>
        <BookOpen aria-hidden="true" size={15} /><span>{notebook?.title ?? "笔记本"}</span>
      </Link>
      <ChevronRight aria-hidden="true" size={13} />
      <span aria-current="page" title={draft?.title || "未命名文档"}>{draft?.title || "未命名文档"}</span>
    </nav>
  );
  const toolbar = (
    <div className="document-header-actions">
      <span className={`document-save-state is-${saveState}`} role="status" aria-live="polite" aria-atomic="true">
        <StateIcon aria-hidden="true" size={14} className={saveState === "saving" ? "document-save-spinner" : ""} /><span>{canEdit ? stateCopy.label : "只读"}</span>
      </span>
      <span className="document-header-divider" aria-hidden="true" />
      <ActionButton ref={collaborationTriggerRef} type="button" className="document-comment-trigger" aria-label="评论与历史" aria-haspopup="dialog" aria-expanded={collaborationOpen} disabled={!draft || archiving} onClick={() => setCollaborationOpen(true)}><MessageSquare aria-hidden="true" size={16} /><span>评论</span></ActionButton>
      {canEdit ? <Dropdown>
        <ActionButton type="button" className="icon-button" aria-label="更多文档操作" disabled={!draft || editorBusy}><MoreHorizontal aria-hidden="true" size={18} /></ActionButton>
        <Dropdown.Popover placement="bottom end" className="document-actions-popover" offset={6}>
          <Dropdown.Menu aria-label="文档操作" onAction={(key) => { if (key === "archive") void handleArchive(); }}>
            <Dropdown.Item id="archive" textValue="归档文档" isDisabled={!draft || editorBusy}><Archive aria-hidden="true" size={16} /><Label>归档文档</Label></Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown> : null}
    </div>
  );

  return (
    <DocumentShell editorLayout breadcrumb={breadcrumb} toolbar={toolbar} notebookId={noteQuery.data?.notebook_id} activeNoteId={noteId}>
      {!draft || !noteQuery.data || hydratedNoteRef.current !== noteId ? <div className="page-container"><LoadingState label="正在打开文档…" variant="editor" /></div> : (
        <EditorLayout outlineStore={outlineStore}>
          <article className="editor-canvas">
            <HeroInput
              aria-label="文档标题"
              className="orbis-embedded-input editor-title"
              placeholder="无标题"
              value={draft.title}
              readOnly={!canEdit || editorBusy}
              onChange={(event) => changeDraft({ ...(coordinatorRef.current?.current ?? draft), title: event.target.value })}
            />
            <div className="mb-7 mt-2 flex items-center gap-2 text-xs text-[var(--muted-light)]"><span>版本 {coordinatorRef.current?.saved?.version ?? draft.version}</span><span>·</span><span>{canEdit ? "停手后自动保存" : "只读访问"}</span></div>

            {archiveError ? <div role="alert" className="mb-5"><StatusMessage tone="error" title="未能归档文档">{archiveError}</StatusMessage></div> : null}
            {saveState === "conflict" ? <div className="mb-5"><StatusMessage tone="warning" title="检测到其他窗口的更新">本地草稿仍保留。建议先复制本地 Markdown，再载入服务端版本。
              <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" icon={<Download aria-hidden="true" size={14} />} onClick={() => void loadCompleteContent().then(() => navigator.clipboard?.writeText(v2ToMarkdown((coordinatorRef.current?.current ?? draft).blocks.blocks))).catch(() => {})}>复制本地 Markdown</Button><Button variant="secondary" icon={<RotateCcw aria-hidden="true" size={14} />} onClick={reloadServer}>载入服务端版本</Button></div>
            </StatusMessage></div> : null}
            {saveState === "error" && !editorError ? <div className="mb-5"><StatusMessage tone="error" title="自动保存失败">网络恢复后可手动重试，本地草稿不会丢失。<div className="mt-3"><Button variant="secondary" icon={<RefreshCw aria-hidden="true" size={14} />} onClick={() => coordinatorRef.current?.retry()}>重试保存</Button></div></StatusMessage></div> : null}

            <EditorErrorBoundary key={noteId}>
              <Suspense fallback={<LoadingState label="正在准备编辑…" variant="editor-body" delayMs={180} />}>
                <LiveDocumentEditor
                  noteId={noteId}
                  blocks={draft.blocks}
                  onContentReady={handle => { contentHandle.current = handle; setEditorReady(Boolean(handle)); }}
                  ensureComplete={loadCompleteContent}
                  hasMoreContent={hasMoreContent}
                  readOnly={!canEdit || editorBusy}
                  onError={(message) => { editorErrorRef.current = message; setEditorError(message); }}
                  onChange={({ blocks }) => changeDraft({ ...(coordinatorRef.current?.current ?? draft), blocks })}
                />
              </Suspense>
            </EditorErrorBoundary>
            {hasMoreContent ? <div ref={loadMoreTarget} className="document-load-more" aria-live="polite">
              {loadingMore ? <LoadingState label="正在载入后续正文…" compact /> : null}
              {loadMoreError ? <StatusMessage tone="error" title="后续正文未能载入">{loadMoreError}<Button variant="secondary" onClick={() => void loadMoreContent().catch(() => {})}>重试加载</Button></StatusMessage> : null}
              {!loadingMore && !loadMoreError ? <Button variant="ghost" onClick={() => void loadMoreContent().catch(() => {})}>继续阅读</Button> : null}
            </div> : null}
          </article>
        </EditorLayout>
      )}
      {collaborationOpen ? <Suspense fallback={<LoadingState label="正在加载评论与历史…" compact />}><DocumentCollaborationPanel key={noteId} noteId={noteId} currentUserId={currentUserId} canManage={canEdit} onClose={closeCollaboration} onRestore={restoreSavedRevision} /></Suspense> : null}
    </DocumentShell>
  );
}
