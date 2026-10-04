import { LoadingState } from "../../shared/ui/LoadingState";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { Input as HeroInput } from "@heroui/react/input";
import { ActionButton } from "../../shared/ui/ActionButton";
import { AlertTriangle, Archive, BookOpen, ChevronRight, MoreHorizontal, Check, Cloud, Download, MessageSquare, RefreshCw, RotateCcw, Save, WifiOff } from "../../shared/ui/icons";
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useStore } from "zustand";

import { ShareButton } from "../sharing/ShareButton";
import { ApiError } from "../../shared/api/api-client";
import { authStore } from "../../shared/auth/auth-store";
import { useOptionalAuthRequest } from "../../shared/auth/use-auth-request";
import { registerPendingNavigation } from "../../shared/navigation/pending-navigation";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { v2ToMarkdown, type NoteBlocksV2 } from "../notes/block-model";
import type { RestoreSavedRevision } from "../collaboration/DocumentCollaborationPanel";
import { canMutateWorkspaceContent } from "../workspace/capabilities";
import { draftScopeKey } from "./draft-checkpoints";
import { useDraftCheckpoints } from "./use-draft-checkpoints";
import { AutosaveCoordinator, type AutosaveState } from "./autosave";
import { normalizeEditorBlocks } from "./editor-blocks";
import { createBlockChanges } from "./block-changes";
import { createEditorDraftFingerprint, type EditorDraft } from "./editor-draft";
import { EditorLayout, EditorOutlineStore } from "./EditorLayout";
import { loadDocumentEditor } from "./editor-module";
import { DocumentShell } from "./DocumentShell";
import { getNoteContentPage, getNoteContentOutline, getNoteChildrenPage, getNoteBlock, isBoundedContentPage } from "./api";
import { appendChildBlocks, hydrateBlockPayload, mergeLoadDescriptors, hasPendingContent, type BlockLoadState } from "./content-window";
import { CONTENT_PAGE_SIZE, CONTENT_COMPLETION_PAGE_SIZE, type EditorContentHandle } from "./editor-content-handle";

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
  ensureBlocks?: (ids: string[]) => Promise<void>;
  hasMoreContent?: boolean;
  loadStates?: ReadonlyMap<string, BlockLoadState>;
  onLoadBlock?: (id: string) => Promise<void>;
}) {
  const local = useRef({ source: blocks, value: blocks });
  // A restored/server revision replaces local content before editability
  // changes reach the editor. ProseMirror owns ordinary input; keep its latest
  // echo for a later parent render without committing React on each key.
  if (local.current.source !== blocks) local.current = { source: blocks, value: blocks };
  return <TiptapEditor {...props} blocks={local.current.value} onChange={next => {
    local.current.value = next.blocks;
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
  const draftKey = draftScopeKey({ origin: new URL(import.meta.env.VITE_API_BASE_URL || "/api", window.location.origin).href, userId: currentUserId, workspaceId: workspace?.id ?? "", noteId });
  const checkpoints = useDraftCheckpoints(draftKey);

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
  const coordinatorMode = useRef<{ coordinator: AutosaveCoordinator<EditorDraft>; mode: { partial: boolean; blocks: boolean } } | null>(null);
  const hydratedNoteRef = useRef<string | null>(null);
  const editorBusy = restoring || archiving;
  const contentHandle = useRef<EditorContentHandle | null>(null);
  const contentWindow = useRef<{ noteId: string; version: number; next: number; total: number; hasMore: boolean; bounded?: boolean } | null>(null);
  const contentAbort = useRef<AbortController | null>(null);
  const loadingRequest = useRef<Promise<void> | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [hasMoreContent, setHasMoreContent] = useState(false);
  const [loadStates, setLoadStates] = useState<ReadonlyMap<string, BlockLoadState>>(new Map());
  const loadStatesRef = useRef(loadStates);
  const childRequests = useRef(new Map<string, Promise<void>>());
  function updateLoadStates(next: ReadonlyMap<string, BlockLoadState>) { loadStatesRef.current = next; setLoadStates(next); }

  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const loadMoreTarget = useRef<HTMLDivElement>(null);
  const navigationStateRef = useRef({ noteId, draftKey, canEdit, restorationConflict });
  navigationStateRef.current = { noteId, draftKey, canEdit, restorationConflict };

  useEffect(() => registerPendingNavigation(async () => {
    const coordinator = coordinatorRef.current;
    function assertReady() {
      const state = navigationStateRef.current;
      if (state.noteId !== noteId || state.draftKey !== draftKey || coordinatorRef.current !== coordinator) {
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
    if (!coordinator || hydratedNoteRef.current !== draftKey || !navigationStateRef.current.canEdit) return;
    await flushCurrentDraft(coordinator);
    assertReady();
  }), [noteId, draftKey]);

  useEffect(() => {
    const note = noteQuery.data;
    const content = contentQuery.data;
    if (!note || !content || (workspace && note.workspace_id !== workspace.id)) return;
    let disposed = false;
    async function initialize(note: NonNullable<typeof noteQuery.data>, content: NonNullable<typeof contentQuery.data>) {
    const recovered = checkpoints.recovery ?? (hydratedNoteRef.current !== draftKey ? await checkpoints.controller.read().catch(() => null) : null);
    if (disposed) return;
    // The version can only move forward per note, so a cached version at or
    // below what we last saved is either our own echo (setQueryData after
    // flush) or a stale query response that arrived late. Rebuilding the
    // draft from either would stomp the live editor (cursor loss, flicker,
    // lost keystrokes). Only a strictly newer server version — a genuine
    // external edit — warrants a rebuild.
    const existing = coordinatorRef.current;
    const saved = existing?.saved;
    // A cache refresh must never replace unsaved work or an active operation.
    if (hydratedNoteRef.current === draftKey && existing && (restoringRef.current || archivingRef.current || existing.state !== "saved")) return;
    const isOwnOrStaleEcho =
      hydratedNoteRef.current === draftKey &&
      saved != null &&
      content.content_version <= saved.version && !checkpoints.recovery;
    if (isOwnOrStaleEcho) return;
    hydratedNoteRef.current = draftKey;
    const paged = "next_offset" in content;
    contentWindow.current = paged ? { noteId, version: content.content_version, next: content.next_offset, total: content.total_blocks, hasMore: content.has_more, bounded: isBoundedContentPage(content) } : null;
    outlineStore.setRemote([], paged ? content.next_offset : Infinity);
    setHasMoreContent(paged && content.has_more);
    updateLoadStates(isBoundedContentPage(content) ? mergeLoadDescriptors(new Map(), content.descriptors) : new Map());
    setLoadMoreError(null);
    const serverInitial = { title: note.title, blocks: normalizeEditorBlocks(noteId, content.blocks), version: content.content_version };
    const fingerprint = createEditorDraftFingerprint();
    const hasRecoveredChanges = Boolean(recovered && fingerprint(recovered.saved) !== fingerprint(recovered.current));
    const initial = hasRecoveredChanges && recovered ? { ...recovered.current, version: recovered.saved.version } : serverInitial;
    const savedInitial = hasRecoveredChanges && recovered ? recovered.saved : serverInitial;
    if (hasRecoveredChanges && recovered) {
      contentWindow.current = recovered.window;
      updateLoadStates(new Map(recovered.descriptors));
      setHasMoreContent(recovered.window?.hasMore ?? false);
    } else if (recovered) { void checkpoints.controller.acknowledge(recovered.sequence).catch(() => {}); }
    setDraft(initial);
    outlineStore.update(initial.blocks);
    coordinatorRef.current?.dispose(false);
    const mode = { partial: paged, blocks: paged && (isBoundedContentPage(content) || content.storage_format === "blocks") };
    const diffBlocks = createBlockChanges();
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
        const acknowledgedSequence = checkpoints.controller.sequence;
        if (current.title.trim() !== saved.title.trim()) {
          await updateNote.mutateAsync({ id: noteId, title: current.title.trim() || "未命名文档" });
        }
        let version = saved.version;
        if (fingerprint({ ...current, title: "" }) !== fingerprint({ ...saved, title: "" })) {
          const result = await saveContent.mutateAsync({ noteId, expectedVersion: saved.version, blocks: current.blocks, ...(mode.blocks ? { changes: diffBlocks(saved.blocks, current.blocks) } : mode.partial ? { loadedBlockIds: saved.blocks.blocks.map(block => block.id) } : {}) });
          version = result.content_version;
        }
        void checkpoints.controller.acknowledge(acknowledgedSequence).catch(() => {});
        return { ...current, title: current.title.trim() || "未命名文档", version };
      },
    });
    coordinator.hydrate(savedInitial);
    if (hasRecoveredChanges) {
      coordinator.change(initial);
      if (savedInitial.version !== content.content_version || !canEdit) { coordinator.holdConflict(); setRestorationConflict(true); }
    }
    coordinatorRef.current = coordinator;
    coordinatorMode.current = { coordinator, mode };
    if (checkpoints.recovery) checkpoints.consumeRecovery();
    }
    void initialize(note, content);
    return () => { disposed = true; };
  }, [contentQuery.data?.content_version, noteId, noteQuery.data?.title, draftKey, checkpoints.controller, checkpoints.recovery, restoring]);

  useEffect(() => {
    setEditorError(null);
    setRestorationConflict(false);
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
  }, [noteId, draftKey]);

  async function loadMoreContent(pageSize = CONTENT_PAGE_SIZE): Promise<void> {
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
      const page = await (window.bounded ? getNoteChildrenPage : getNoteContentPage)(noteId, documentAuth, { offset: window.next, limit: pageSize, version: window.version, signal: abort.signal });
      if (!("next_offset" in page) || page.content_version !== window.version || page.offset !== window.next) throw new Error("后续正文的版本不一致，请重新载入文档。");
      await coordinator.settlePendingSave();
      if (abort.signal.aborted || coordinatorRef.current !== coordinator || contentWindow.current !== window || contentHandle.current !== handle) return;
      const addition = normalizeEditorBlocks(noteId, page.blocks).blocks;
      if (isBoundedContentPage(page)) updateLoadStates(mergeLoadDescriptors(loadStatesRef.current, page.descriptors));
      const wasSaved = coordinator.state === "saved";
      if (!wasSaved) coordinator.extend(value => ({ ...value, blocks: { ...value.blocks, blocks: [...value.blocks.blocks, ...addition] } }));
      const live = handle.append(addition);
      const current = coordinator.current!;
      if (wasSaved) coordinator.hydrate({ ...current, blocks: live });
      else coordinator.alignCurrentAfterRead({ ...current, blocks: live });
      setDraft(coordinator.current);
      outlineStore.setBoundary(page.next_offset);
      outlineStore.update(live);
      window.next = page.next_offset;
      window.hasMore = page.has_more;
      if (coordinator.state !== "saved") checkpointDraft(coordinator);
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

  async function loadNestedContent(id: string, pageSize = CONTENT_PAGE_SIZE): Promise<void> {
    const active = childRequests.current.get(id);
    if (active) return active;
    const descriptor = loadStatesRef.current.get(id);
    const window = contentWindow.current;
    const coordinator = coordinatorRef.current;
    const handle = contentHandle.current;
    const abort = contentAbort.current;
    if (!descriptor || !window || !coordinator || !handle || !abort || !documentAuth) return;
    const mark = (patch: Partial<BlockLoadState>) => {
      const states = new Map(loadStatesRef.current);
      const previous = states.get(id);
      if (previous) { states.set(id, { ...previous, ...patch }); updateLoadStates(states); }
    };
    mark({ loading: true, error: null });
    const task = (async () => {
      await coordinator.settlePendingSave();
      const stillCurrent = () => !abort.signal.aborted && coordinatorRef.current === coordinator && contentWindow.current === window && contentHandle.current === handle;
      if (!descriptor.payload_loaded) {
        const result = await getNoteBlock(noteId, id, window.version, documentAuth, abort.signal);
        if (!stillCurrent()) return;
        const incoming = normalizeEditorBlocks(noteId, { schema_version: 2, editor: "blocknote", blocks: [result.block] }).blocks[0];
        const wasSaved = coordinator.state === "saved";
        if (!wasSaved) coordinator.extend(value => ({ ...value, blocks: hydrateBlockPayload(value.blocks, incoming) }));
        const live = handle.hydratePayload(incoming);
        if (wasSaved) coordinator.hydrate({ ...coordinator.current!, blocks: live });
        else coordinator.alignCurrentAfterRead({ ...coordinator.current!, blocks: live });
        mark({ payload_loaded: true });
      } else if (!descriptor.children_loaded) {
        const page = await getNoteChildrenPage(noteId, documentAuth, { parentId: id, offset: descriptor.offset, limit: pageSize, version: window.version, signal: abort.signal });
        if (!(isBoundedContentPage(page)) || page.content_version !== window.version || page.offset !== descriptor.offset) throw new Error("子内容版本不一致，请重新载入文档。");
        if (!stillCurrent()) return;
        const incoming = normalizeEditorBlocks(noteId, page.blocks).blocks;
        const wasSaved = coordinator.state === "saved";
        if (!wasSaved) coordinator.extend(value => ({ ...value, blocks: appendChildBlocks(value.blocks, id, incoming) }));
        const live = handle.appendChildren(id, incoming);
        if (wasSaved) coordinator.hydrate({ ...coordinator.current!, blocks: live });
        else coordinator.alignCurrentAfterRead({ ...coordinator.current!, blocks: live });
        updateLoadStates(mergeLoadDescriptors(loadStatesRef.current, page.descriptors));
        mark({ offset: page.next_offset, children_loaded: !page.has_more });
      }
      if (stillCurrent()) { setDraft(coordinator.current); outlineStore.update(coordinator.current!.blocks); if (coordinator.state !== "saved") checkpointDraft(coordinator); }
    })();
    childRequests.current.set(id, task);
    try { await task; }
    catch (error) {
      if (!abort.signal.aborted && coordinatorRef.current === coordinator) mark({ error: error instanceof Error ? error.message : "子内容加载失败，请重试。" });
      throw error;
    } finally {
      if (childRequests.current.get(id) === task) childRequests.current.delete(id);
      if (!abort.signal.aborted && coordinatorRef.current === coordinator) mark({ loading: false });
    }
  }

  async function loadCompleteContent(): Promise<void> {
    if (!contentHandle.current) throw new Error("正文尚未准备好，请稍后重试。");
    while (contentWindow.current?.noteId === noteId && contentWindow.current.hasMore) await loadMoreContent(contentWindow.current.bounded ? CONTENT_COMPLETION_PAGE_SIZE : CONTENT_PAGE_SIZE);
    const present = new Set<string>();
    const collect = (items: import("../notes/block-model").OrbisBlock[]) => { for (const item of items) { present.add(item.id); collect(item.children); } };
    if (coordinatorRef.current?.current) collect(coordinatorRef.current.current.blocks.blocks);
    const retained = new Map([...loadStatesRef.current].filter(([id]) => present.has(id)));
    updateLoadStates(retained);
    while (hasPendingContent(loadStatesRef.current)) {
      const pending = [...loadStatesRef.current.values()].find(item => !item.payload_loaded || !item.children_loaded);
      if (pending) await loadNestedContent(pending.id, CONTENT_COMPLETION_PAGE_SIZE);
    }
  }

  async function loadSelectedSubtrees(ids: string[]): Promise<void> {
    const handle = contentHandle.current;
    const coordinator = coordinatorRef.current;
    const window = contentWindow.current;
    const abort = contentAbort.current;
    if (!handle || !coordinator || !window || !abort) throw new Error("正文尚未准备好，请稍后重试。");
    const sameSession = () => !abort.signal.aborted && contentHandle.current === handle && coordinatorRef.current === coordinator && contentWindow.current === window;
    while (sameSession()) {
      const selected = new Set(ids);
      const present = new Set<string>();
      const retained = new Set<string>();
      const visit = (items: import("../notes/block-model").OrbisBlock[], within = false) => {
        for (const item of items) {
          if (selected.has(item.id)) present.add(item.id);
          const chosen = within || selected.has(item.id);
          if (chosen) retained.add(item.id);
          visit(item.children, chosen);
        }
      };
      visit(handle.snapshot().blocks);
      if (ids.some(id => !present.has(id))) throw new Error("目标块已不在当前文档中，操作已取消。");
      const pending = [...retained].find(id => {
        const state = loadStatesRef.current.get(id);
        return state && (!state.payload_loaded || !state.children_loaded);
      });
      if (!pending) return;
      const before = loadStatesRef.current.get(pending)!;
      await loadNestedContent(pending);
      if (!sameSession()) break;
      const after = loadStatesRef.current.get(pending);
      if (!after || after.offset === before.offset && after.payload_loaded === before.payload_loaded && after.children_loaded === before.children_loaded) throw new Error("子内容未能完整载入，请重试后再操作。");
    }
    throw new Error("文档已切换，读取已取消，原内容已保留。");
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

  const showLocalCheckpoint = saveState === "dirty" || saveState === "saving" || (saveState === "error" && !editorError);
  const checkpointCopy = !showLocalCheckpoint ? null : checkpoints.status.status === "saved" ? "已保存到本机，等待同步" : checkpoints.status.status === "pending" ? "正在保存到本机…" : null;
  const stateCopy = saveStateCopy[saveState];
  const StateIcon = stateCopy.icon;

  function checkpointDraft(coordinator: AutosaveCoordinator<EditorDraft>) {
    if (!coordinator.saved || !coordinator.current) return;
    const window = contentWindow.current;
    const descriptors = loadStatesRef.current;
    checkpoints.controller.schedule(() => ({ saved: coordinator.saved!, current: coordinator.current!, window, descriptors: [...descriptors] }));
  }

  function changeDraft(next: EditorDraft) {
    if (!canEdit || restoringRef.current || archivingRef.current) return;
    // The live body belongs to ProseMirror and the save coordinator. Only
    // title changes need to refresh the workspace breadcrumb and outer shell.
    if (next.title !== draft?.title) setDraft(next);
    outlineStore.update(next.blocks);
    const coordinator = coordinatorRef.current;
    coordinator?.change(next);
    if (coordinator) checkpointDraft(coordinator);
  }

  async function recoverLocalDraft(record: import("./draft-checkpoints").DraftCheckpoint) {
    if (!canEdit || coordinatorRef.current?.state !== "saved" || restoringRef.current || archivingRef.current) return;
    restoringRef.current = true; setRestoring(true);
    try { await checkpoints.chooseRecovery(record); }
    catch (error) { setEditorError(error instanceof Error ? error.message : "本机草稿恢复失败，请重试。"); }
    finally { restoringRef.current = false; setRestoring(false); }
  }

  async function reloadServer() {
    if (restoringRef.current || archivingRef.current) return;
    // Explicitly replace the draft only after both server reads succeed.
    const coordinator = coordinatorRef.current;
    coordinator?.dispose(false);
    const [noteResult, contentResult] = await Promise.all([noteQuery.refetch(), contentQuery.refetch()]);
    if (coordinatorRef.current !== coordinator || !noteResult.data || !contentResult.data || noteResult.error || contentResult.error) return;
    const next = { title: noteResult.data.title, blocks: normalizeEditorBlocks(noteId, contentResult.data.blocks), version: contentResult.data.content_version };
    if (coordinatorMode.current?.coordinator === coordinator) { coordinatorMode.current.mode.partial = "next_offset" in contentResult.data; coordinatorMode.current.mode.blocks = "next_offset" in contentResult.data && (isBoundedContentPage(contentResult.data) || contentResult.data.storage_format === "blocks"); }
    const content = contentResult.data;
    contentWindow.current = "next_offset" in content ? { noteId, version: content.content_version, next: content.next_offset, total: content.total_blocks, hasMore: content.has_more, bounded: isBoundedContentPage(content) } : null;
    setHasMoreContent(contentWindow.current?.hasMore ?? false);
    updateLoadStates(isBoundedContentPage(content) ? mergeLoadDescriptors(new Map(), content.descriptors) : new Map());
    coordinatorRef.current?.hydrate(next);
    void checkpoints.controller.acknowledge(checkpoints.controller.sequence).catch(() => {});
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
      void checkpoints.controller.acknowledge(checkpoints.controller.sequence).catch(() => {});
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
        <StateIcon aria-hidden="true" size={14} className={saveState === "saving" ? "document-save-spinner" : ""} /><span>{canEdit ? checkpointCopy ?? stateCopy.label : "只读"}</span>
      </span>
      <span className="document-header-divider" aria-hidden="true" />
      {canEdit && noteQuery.data ? <ShareButton notebookId={noteQuery.data.notebook_id!} noteId={noteId} title={draft?.title || noteQuery.data.title} /> : null}
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
      {!draft || !noteQuery.data || hydratedNoteRef.current !== draftKey ? <div className="page-container"><LoadingState label="正在打开文档…" variant="editor" /></div> : (
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
            {checkpoints.candidates.length ? <StatusMessage tone="warning" title="检测到其他会话保留的本机草稿">选择需要恢复的内容，原会话草稿会继续保留。<div className="mt-3 flex flex-wrap gap-2">{checkpoints.candidates.map(record => <Button key={record.scopeKey} size="sm" variant="secondary" disabled={autosaveState !== "saved"} onClick={() => void recoverLocalDraft(record)}>恢复“{record.current.title || "未命名文档"}”（基础版本 {record.saved.version}）</Button>)}<Button size="sm" variant="ghost" onClick={checkpoints.dismissCandidates}>稍后处理</Button></div></StatusMessage> : null}
            {checkpoints.status.status === "failed" && autosaveState !== "saved" ? <StatusMessage tone="warning" title="本机草稿尚未持久保存">浏览器存储暂不可用，请保持页面打开并重试同步。<Button variant="ghost" onClick={() => void checkpoints.controller.flush().catch(() => {})}>重试保存到本机</Button></StatusMessage> : null}
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
                  hasMoreContent={hasMoreContent || hasPendingContent(loadStates)}
                  loadStates={loadStates}
                  onLoadBlock={loadNestedContent}
                  ensureBlocks={loadSelectedSubtrees}
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
