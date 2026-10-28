import { releaseFeatures } from "../../../shared/release-features";
import { ConfirmAction } from "../../../shared/ui/ConfirmAction";
import { markErrorHandled, reportError, reportRequestError } from "../../../shared/api/request-feedback";
import { DraftActions } from "../../../shared/ui/DraftActions";
import {cacheDocumentCommit} from "../document-cache";
import {annotateTableCopies,resolveTableCopies,type TableCopyIntent} from "./table-copy";
import {DocumentCopyContext,type DocumentCopyPort} from "./blocks/block-copy-context";
import {indexBlocks} from "./blocks/block-tree";
import { LoadingState } from "../../../shared/ui/LoadingState";
import { TableHostContext, replaceTableBlock, type TableHost,type PendingTableWriter } from "../../data-tables/context";
import { Dropdown } from "@heroui/react/dropdown";
import { Label } from "@heroui/react/label";
import { Input as HeroInput } from "@heroui/react/input";
import { ActionButton } from "../../../shared/ui/ActionButton";
import { AlertTriangle, Archive, BookOpen, ChevronRight, MoreHorizontal, Check, Cloud, Download, MessageSquare, RefreshCw, RotateCcw, Save, WifiOff } from "../../../shared/ui/icons";
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useStore } from "zustand";

import { ShareButton } from "../../sharing/ShareButton";
import { ApiError } from "../../../shared/api/api-client";
import { authStore } from "../../../shared/auth/auth-store";
import { useOptionalAuthRequest } from "../../../shared/auth/use-auth-request";
import { registerPendingNavigation } from "../../../shared/navigation/pending-navigation";
import { Button } from "../../../shared/ui/Button";

import { v2ToMarkdown, type NoteBlocksV2 } from "../../content/blocks";
import type { RestoreSavedRevision } from "../../collaboration/DocumentCollaborationPanel";
import { canMutateWorkspaceContent } from "../../workspace/capabilities";
import { checkpointRecoveryIssue,draftScopeKey } from "./draft-checkpoints";
import { useDraftCheckpoints } from "./use-draft-checkpoints";
import { AutosaveCoordinator, type AutosaveState } from "./autosave";
import { normalizeEditorBlocks } from "./editor-blocks";
import type { OrbisBlock } from "../../content/blocks";
import { DocumentWriter } from "./document-writer";
import type { DraftContentWindow } from "./draft-checkpoints";
import { useQueryClient } from "@tanstack/react-query";
import { createBlockChanges } from "./block-changes";
import { createEditorDraftFingerprint, type EditorDraft } from "./editor-draft";
import { EditorLayout, EditorOutlineStore } from "./EditorLayout";
import { loadDocumentEditor } from "./editor-module";
import { DocumentShell } from "../DocumentShell";
import { getNoteContentOutline, getNoteChildrenPage, getNoteBlock, isBoundedContentPage } from "../api";
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
} from "../queries";
import { isUnavailableResourceError } from "../resource-errors";

const DocumentCollaborationPanel = lazy(() =>
  import("../../collaboration/DocumentCollaborationPanel").then((module) => ({ default: module.DocumentCollaborationPanel })),
);

const saveStateCopy: Record<AutosaveState, { label: string; icon: typeof Save }> = {
  saved: { label: "已保存", icon: Check },
  dirty: { label: "等待保存", icon: Cloud },
  saving: { label: "保存中…", icon: RefreshCw },
  error: { label: "保存失败", icon: WifiOff },
  conflict: { label: "版本冲突", icon: AlertTriangle },
};

class EditorErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  componentDidCatch() { reportError("页面内容无法显示，请刷新重试。"); }

  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        null
      );
    }
    return this.props.children;
  }
}

export function LegacyDocumentEditorPage() {
  const { noteId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const commentId = searchParams.get("comment");
  const outlineStore = useMemo(() => new EditorOutlineStore(), [noteId]);
  useEffect(() => { void loadDocumentEditor().catch(() => { /* The editor boundary reports module load failures. */ }); }, []);
  const workspace = useStore(authStore, (state) => state.workspace);
  const canEdit = canMutateWorkspaceContent(workspace);
  const currentUserId = useStore(authStore, (state) => state.user?.id ?? "");
  const draftKey = draftScopeKey({ origin: new URL(import.meta.env.VITE_API_BASE_URL || "/api", window.location.origin).href, userId: currentUserId, workspaceId: workspace?.id ?? "", noteId });
  const checkpoints = useDraftCheckpoints(draftKey);

  const tableWriters=useMemo(()=>new Map<string,PendingTableWriter>(),[draftKey]);
  const noteQuery = useNote(noteId);
  const notebook = useNotebook(noteQuery.data?.notebook_id).data;
  const contentQuery = useNoteContent(noteId, { pageSize: CONTENT_PAGE_SIZE });
  const documentAuth = useOptionalAuthRequest();
  const saveContent = useSaveNoteContent();
  const archiveNote = useArchiveNote();
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [retainedDraft,setRetainedDraft]=useState<{record:import("./draft-checkpoints").DraftCheckpoint;message:string}|null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const editorErrorRef = useRef<string | null>(null);
  const [autosaveState, setSaveState] = useState<AutosaveState>("saved");
  const [collaborationOpen, setCollaborationOpen] = useState(Boolean(releaseFeatures.documentCollaboration && commentId));
  const [collaborationMounted, setCollaborationMounted] = useState(Boolean(releaseFeatures.documentCollaboration && commentId));
  const [collaborationSession, setCollaborationSession] = useState(0);
  useEffect(() => { setCollaborationOpen(Boolean(releaseFeatures.documentCollaboration && commentId)); if (releaseFeatures.documentCollaboration && commentId) setCollaborationMounted(true); }, [noteId, commentId]);
  const [restoring, setRestoring] = useState(false);
  const [archiving, setArchiving] = useState(false);
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
  const contentWindow = useRef<DraftContentWindow | null>(null);
  const writerRef = useRef<DocumentWriter | null>(null);
  const readOwnerRef=useRef<{coordinator:AutosaveCoordinator<EditorDraft>|null;window:DraftContentWindow|null;states:ReadonlyMap<string,BlockLoadState>;copies:Map<string,TableCopyIntent>}|null>(null);
  function assignContentWindow(value:DraftContentWindow|null){contentWindow.current=value;if(readOwnerRef.current?.coordinator===coordinatorRef.current)readOwnerRef.current!.window=value;}
  const contentAbort = useRef<AbortController | null>(null);
  const loadingRequest = useRef<Promise<void> | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [hasMoreContent, setHasMoreContent] = useState(false);
  const [loadStates, setLoadStates] = useState<ReadonlyMap<string, BlockLoadState>>(new Map());
  const loadStatesRef = useRef(loadStates);
  const childRequests = useRef(new Map<string, Promise<void>>());
  function updateLoadStates(next: ReadonlyMap<string, BlockLoadState>) { outlineStore.setReadState(next);loadStatesRef.current = next;if(readOwnerRef.current?.coordinator===coordinatorRef.current)readOwnerRef.current!.states=next;setLoadStates(next); }

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
    if (restoringRef.current || !note || !content || (workspace && note.workspace_id !== workspace.id)) return;
    let disposed = false;
    async function initialize(note: NonNullable<typeof noteQuery.data>, content: NonNullable<typeof contentQuery.data>) {
    let recovered = checkpoints.recovery ?? (hydratedNoteRef.current !== draftKey ? await checkpoints.controller.read().catch(() => null) : null);
    if (disposed) return;
    if (recovered) {
      const message = checkpointRecoveryIssue(recovered, noteId);
      if (message) {
        setRetainedDraft({ record: recovered, message });
        await checkpoints.controller.startFresh();
        if (disposed) return;
        recovered = null;
        checkpoints.consumeRecovery();
      }
    }
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
    const paged = "next_cursor" in content;
    assignContentWindow(paged ? { noteId, version: content.content_version, cursor: content.next_cursor, loaded: content.read_position, hasMore: content.has_more, bounded: isBoundedContentPage(content) } : null);
    outlineStore.reset();
    outlineStore.setSourceRoots(normalizeEditorBlocks(noteId,content.blocks).blocks);
    outlineStore.setRemote([], paged ? content.read_position : Infinity);
    setHasMoreContent(paged && content.has_more);
    updateLoadStates(isBoundedContentPage(content) ? mergeLoadDescriptors(new Map(), content.descriptors) : new Map());
    setLoadMoreError(null);
    const serverInitial = { title: content.title ?? note.title, blocks: normalizeEditorBlocks(noteId, content.blocks), version: content.content_version };
    const fingerprint = createEditorDraftFingerprint();
    const hasRecoveredChanges = Boolean(recovered && (fingerprint(recovered.saved) !== fingerprint(recovered.current) || Boolean(recovered.pending)));
    const initial = hasRecoveredChanges && recovered ? { ...recovered.current, version: recovered.saved.version } : serverInitial;
    const savedInitial = hasRecoveredChanges && recovered ? recovered.saved : serverInitial;
    if (hasRecoveredChanges && recovered) {
      assignContentWindow(recovered.window);
      updateLoadStates(new Map(recovered.descriptors));
      setHasMoreContent(recovered.window?.hasMore ?? false);
    } else if (recovered) { void checkpoints.controller.acknowledge(recovered.sequence).catch(() => {}); }
    setDraft(initial);
    outlineStore.update(initial.blocks);
    coordinatorRef.current?.dispose(false);
    const mode = { partial: paged, blocks: paged && (isBoundedContentPage(content)) };
    const diffBlocks = createBlockChanges();
    let coordinator:AutosaveCoordinator<EditorDraft>;
    const copies=new Map<string,TableCopyIntent>();
    if(hasRecoveredChanges&&recovered)for(const copy of [...(recovered.current.tableCopies??[]),...(recovered.pending?.table_copies??[])])copies.set(copy.block_id,copy);
    const readOwner={coordinator:null as AutosaveCoordinator<EditorDraft>|null,window:contentWindow.current,states:loadStatesRef.current,copies};
    const writer = new DocumentWriter({
      documentId:noteId,
      checkpoint:async (_pending,flush) => {
        if(!coordinator.saved||!coordinator.current)return;
        checkpoints.controller.schedule(()=>({saved:coordinator.saved!,current:coordinator.current!,window:readOwner.window,descriptors:[...readOwner.states],pending:writer.pending}));
        if(flush)await checkpoints.controller.flush();
      },
      write:pending=>saveContent.mutateAsync(pending),
      onResolved:(copied,resolved,version)=>{
        if(!coordinator.current)return;
        const previous=indexBlocks(coordinator.current.blocks.blocks);
        const next=resolveTableCopies(coordinator.current,copied,resolved,version);
        coordinator.alignCurrentAfterRead(next);
        for(const copy of copied)readOwner.copies.delete(copy.block_id);
        if(coordinatorRef.current!==coordinator)return;
        const updated=indexBlocks(next.blocks.blocks);
        for(const copy of copied){
          const before=previous.get(copy.block_id)?.block,after=updated.get(copy.block_id)?.block;
          if(before&&after&&before!==after)contentHandle.current?.hydratePayload(after);
        }
        outlineStore.update(next.blocks);
      },
      onDeleted:ids=>{
        const window=readOwner.window;
        if(window)window.suppressed=[...new Set([...(window.suppressed??[]),...ids])];
        const states=new Map(readOwner.states);
        for(const id of ids)states.delete(id);
        readOwner.states=states;
        if(coordinatorRef.current===coordinator)updateLoadStates(states);
      },
    });
    writer.restore(hasRecoveredChanges ? recovered?.pending : null);
    coordinator = new AutosaveCoordinator<EditorDraft>({
      delayMs:750,minIntervalMs:2_000,maxDelayMs:15_000,fingerprint,hasPendingWrite:()=>writer.pending!==null,
      onStateChange:state=>{if(coordinatorRef.current===coordinator)setSaveState(state);},
      save:async(current,saved)=>{
        const window=readOwner.window;
        const complete=Boolean(window && !window.hasMore && !hasPendingContent(readOwner.states));
        return writer.save(current,saved,complete,diffBlocks(saved.blocks,current.blocks));
      },
    });
    coordinator.hydrate(savedInitial);
    if (hasRecoveredChanges) {
      coordinator.change(initial);
      if ((!recovered?.pending && savedInitial.version !== content.content_version) || !canEdit) { coordinator.holdConflict(); setRestorationConflict(true); }
    }
    coordinatorRef.current = coordinator;
    readOwner.coordinator=coordinator;
    readOwnerRef.current=readOwner;
    writerRef.current = writer;
    setSaveState(coordinator.state);
    coordinatorMode.current = { coordinator, mode };
    if (checkpoints.recovery) checkpoints.consumeRecovery();
    }
    void initialize(note, content).catch(error=>{if(!disposed){editorErrorRef.current=error instanceof Error?error.message:"本机草稿恢复失败。";setEditorError(editorErrorRef.current);}});
    return () => { disposed = true; };
  // A recovered receipt may precede an already loaded newer server revision.
  // Revisit that snapshot when the pending write settles and the draft is clean.
  }, [contentQuery.data?.content_version, noteId, noteQuery.data?.title, draftKey, checkpoints.controller, checkpoints.recovery, restoring,autosaveState]);

  useEffect(() => {
    setEditorError(null);
    setRetainedDraft(null);
    setRestorationConflict(false);
    editorErrorRef.current = null;
    setArchiving(false);

    const abort = new AbortController();
    contentAbort.current = abort;
    return () => {
      abort.abort();
      contentHandle.current = null;
      contentWindow.current = null;
      loadingRequest.current = null;
      const coordinator = coordinatorRef.current;
      const cached = queryClient.getQueryData<{content_version:number}>(["note-content-pages",noteId]);
      if(cached && coordinator?.saved && cached.content_version<coordinator.saved.version)queryClient.removeQueries({queryKey:["note-content-pages",noteId],exact:true});
      writerRef.current = null;
      readOwnerRef.current=null;
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
      await coordinator.settlePendingSave();
      if(writerRef.current?.pending)throw new Error("请先确认上次保存结果，再继续载入内容。");
      const page = await getNoteChildrenPage(noteId, documentAuth, { cursor: window.cursor, limit: pageSize, version: window.version, signal: abort.signal });
      if (!("next_cursor" in page) || page.content_version !== window.version) throw new Error("后续正文的版本不一致，请重新载入文档。");
      await coordinator.settlePendingSave();
      if (abort.signal.aborted || coordinatorRef.current !== coordinator || contentWindow.current !== window || contentHandle.current !== handle) return;
      if(writerRef.current?.pending)throw new Error("请先确认上次保存结果，再继续载入内容。");
      const suppressed=new Set(window.suppressed??[]);
      const liveBefore=handle.snapshot();
      const addition=appendChildBlocks(liveBefore,null,normalizeEditorBlocks(noteId,page.blocks).blocks,suppressed).blocks.slice(liveBefore.blocks.length);
      const added=new Set(addition.map(block=>block.id));
      updateLoadStates(mergeLoadDescriptors(loadStatesRef.current,page.descriptors.filter(item=>added.has(item.id))));
      const wasSaved = coordinator.state === "saved";
      if (!wasSaved) coordinator.extend(value => ({ ...value,blocks:appendChildBlocks(value.blocks,null,addition,suppressed) }));
      const live = handle.append(addition);
      const current = coordinator.current!;
      if (wasSaved) coordinator.hydrate({ ...current, blocks: live });
      else coordinator.alignCurrentAfterRead({ ...current, blocks: live });
      setDraft(coordinator.current);
      outlineStore.setSourceRoots(normalizeEditorBlocks(noteId,page.blocks).blocks,page.read_position-normalizeEditorBlocks(noteId,page.blocks).blocks.length);
      outlineStore.setBoundary(page.read_position);
      outlineStore.update(live);
      window.cursor = page.next_cursor;
      window.loaded = Math.max(window.loaded,page.read_position);
      window.hasMore = page.has_more;
      if (coordinator.state !== "saved") checkpointDraft(coordinator);
      setHasMoreContent(page.has_more);
    })();
    loadingRequest.current = task;
    try { await task; }
    catch (error) {
      if (!abort.signal.aborted && contentWindow.current === window) {
        reportRequestError(error);
        setLoadMoreError(error instanceof Error ? error.message : "后续正文加载失败，请重试。");
      } else markErrorHandled(error);
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
      if(writerRef.current?.pending)throw new Error("请先确认上次保存结果，再继续载入内容。");
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
        const page = await getNoteChildrenPage(noteId, documentAuth, { parentId: id, cursor: descriptor.cursor, limit: pageSize, version: window.version, signal: abort.signal });
        if (!(isBoundedContentPage(page)) || page.content_version !== window.version) throw new Error("子内容版本不一致，请重新载入文档。");
        if (!stillCurrent()) return;
        await coordinator.settlePendingSave();
        if(!stillCurrent())return;
        if(writerRef.current?.pending)throw new Error("请先确认上次保存结果，再继续载入内容。");
        const suppressed=new Set(window.suppressed??[]);
        const known=new Set<string>();
        const collect=(blocks:OrbisBlock[])=>{for(const block of blocks){known.add(block.id);collect(block.children);}};
        collect(handle.snapshot().blocks);
        const incoming=normalizeEditorBlocks(noteId,page.blocks).blocks.filter(block=>!known.has(block.id)&&!suppressed.has(block.id));
        const wasSaved = coordinator.state === "saved";
        if (!wasSaved) coordinator.extend(value => ({ ...value, blocks: appendChildBlocks(value.blocks, id, incoming,suppressed) }));
        const live = handle.appendChildren(id, incoming);
        if (wasSaved) coordinator.hydrate({ ...coordinator.current!, blocks: live });
        else coordinator.alignCurrentAfterRead({ ...coordinator.current!, blocks: live });
        const added=new Set(incoming.map(block=>block.id));
        updateLoadStates(mergeLoadDescriptors(loadStatesRef.current,page.descriptors.filter(item=>added.has(item.id))));
        mark({ cursor: page.next_cursor, loaded_count:page.read_position, children_loaded: !page.has_more });
      }
      if (stillCurrent()) { setDraft(coordinator.current); outlineStore.update(coordinator.current!.blocks); if (coordinator.state !== "saved") checkpointDraft(coordinator); }
    })();
    childRequests.current.set(id, task);
    try { await task; }
    catch (error) {
      if (!abort.signal.aborted && coordinatorRef.current === coordinator) {
        reportRequestError(error);
        mark({ error: error instanceof Error ? error.message : "子内容加载失败，请重试。" });
      } else markErrorHandled(error);
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
    const collect = (items: import("../../content/blocks").OrbisBlock[]) => { for (const item of items) { present.add(item.id); collect(item.children); } };
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
      const visit = (items: import("../../content/blocks").OrbisBlock[], within = false) => {
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
      if (!after || after.cursor === before.cursor && after.payload_loaded === before.payload_loaded && after.children_loaded === before.children_loaded) throw new Error("子内容未能完整载入，请重试后再操作。");
    }
    throw new Error("文档已切换，读取已取消，原内容已保留。");
  }

  const loadMoreRef = useRef(loadMoreContent);
  loadMoreRef.current = loadMoreContent;
  const expandedTableId = searchParams.get("table");
  useEffect(() => {
    if (!editorReady || !expandedTableId || document.querySelector(`[data-orbis-block-id="${CSS.escape(expandedTableId)}"]`)) return;
    // An explicit deep link may point beyond the initial document window.
    void loadCompleteContent().catch(error => setEditorError(error instanceof Error ? error.message : "表格所在内容未能载入"));
  }, [editorReady, expandedTableId, noteId]);
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
    if (!editorReady || !window || (!window.hasMore&&!hasPendingContent(loadStatesRef.current)) || window.noteId !== noteId || !documentAuth) return;
    const abort = new AbortController();
    void getNoteContentOutline(noteId, window.version, documentAuth, abort.signal).then(outline => {
      if (!abort.signal.aborted && contentWindow.current === window) outlineStore.setRemote(outline.items, window.loaded);
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
    const writer=writerRef.current;
    checkpoints.controller.schedule(() => ({ saved: coordinator.saved!, current: coordinator.current!, window, descriptors: [...descriptors],pending:writer?.pending??null }));
  }

  function changeDraft(next: EditorDraft) {
    if (!canEdit || restoringRef.current || archivingRef.current) return;
    const owner=readOwnerRef.current;
    if(owner?.coordinator===coordinatorRef.current)next=annotateTableCopies(next,owner.copies);
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
    catch (error) { reportError(error);  setEditorError(error instanceof Error ? error.message : "本机草稿恢复失败，请重试。"); }
    finally { restoringRef.current = false; setRestoring(false); }
  }

  async function reloadServer() {
    if (restoringRef.current || archivingRef.current) return;
    restoringRef.current=true;setRestoring(true);
    try {
    // Explicitly replace the draft only after both server reads succeed.
    const coordinator = coordinatorRef.current;
    await coordinator?.settlePendingSave();
    const [noteResult, contentResult] = await Promise.all([noteQuery.refetch(), contentQuery.refetch()]);
    if (coordinatorRef.current !== coordinator || !noteResult.data || !contentResult.data || noteResult.error || contentResult.error) return;
    coordinator?.dispose(false);
    const next = { title: contentResult.data.title ?? noteResult.data.title, blocks: normalizeEditorBlocks(noteId, contentResult.data.blocks), version: contentResult.data.content_version };
    if (coordinatorMode.current?.coordinator === coordinator) { coordinatorMode.current.mode.partial = "next_cursor" in contentResult.data; coordinatorMode.current.mode.blocks = "next_cursor" in contentResult.data && (isBoundedContentPage(contentResult.data)); }
    const content = contentResult.data;
    assignContentWindow("next_cursor" in content ? { noteId, version: content.content_version, cursor: content.next_cursor, loaded: content.read_position, hasMore: content.has_more, bounded: isBoundedContentPage(content) } : null);
    setHasMoreContent(contentWindow.current?.hasMore ?? false);
    updateLoadStates(isBoundedContentPage(content) ? mergeLoadDescriptors(new Map(), content.descriptors) : new Map());
    writerRef.current?.discard();
    readOwnerRef.current?.copies.clear();
    coordinatorRef.current?.hydrate(next);
    void checkpoints.controller.acknowledge(checkpoints.controller.sequence).catch(() => {});
    setDraft(next);
    outlineStore.update(next.blocks);
    setRestorationConflict(false);
    }catch(error){ reportError(error); setEditorError(error instanceof Error?error.message:"服务端版本载入失败，请重试。");}
    finally{restoringRef.current=false;setRestoring(false);}
  }

  async function flushCurrentDraft(coordinator: AutosaveCoordinator<EditorDraft>) {
    if (editorErrorRef.current) throw new Error(editorErrorRef.current);
    do{
      await coordinator.flush();
      if(coordinatorRef.current!==coordinator)throw new DOMException("The document scope changed","AbortError");
      if(coordinator.state!=="saved")throw new Error("当前草稿尚未成功保存。请先处理保存失败或版本冲突，本地草稿仍保留。");
      for(const writer of [...tableWriters.values()])if(writer.hasPending())await writer.flush();
      await coordinator.flush();
      if(coordinatorRef.current!==coordinator)throw new DOMException("The document scope changed","AbortError");
    }while(coordinator.state==="saved"&&[...tableWriters.values()].some(writer=>writer.hasPending()));
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
      const next = { ...saved,title:restored.title??saved.title, blocks: normalizeEditorBlocks(noteId, restored.blocks), version: restored.content_version };
      assignContentWindow({ noteId, version: restored.content_version, cursor: null, loaded: next.blocks.blocks.length, hasMore: false });
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
      reportError("保存未完成，请刷新后再归档文档。");
      return;
    }
    archivingRef.current = coordinator;
    setArchiving(true);

    try {
      await flushCurrentDraft(coordinator);
      if (!notebook) throw new Error("目录版本尚未载入，请重新载入。");
      await archiveNote.mutateAsync({ id: noteId, archived: true,expected_directory_version:notebook.directory_version });
      if (coordinatorRef.current === coordinator) navigate(`/collections/${note.notebook_id}`, { replace: true });
    } catch (error) {
      if (coordinatorRef.current === coordinator) {
        reportError(error);
      }
    } finally {
      if (archivingRef.current === coordinator) {
        archivingRef.current = null;
        if (coordinatorRef.current === coordinator) setArchiving(false);
      }
    }
  }

  const tableHost = useMemo<TableHost>(() => ({
    noteId, auth: documentAuth, readOnly: !canEdit || editorBusy,canRecoverDraft:canEdit,
    registerWriter:(blockId,writer)=>{tableWriters.set(blockId,writer);return()=>{if(tableWriters.get(blockId)===writer)tableWriters.delete(blockId);};},
    isCopyPending:blockId=>readOwnerRef.current?.copies.has(blockId)??false,
    documentVersion:()=>{
      const coordinator=coordinatorRef.current;
      const version=Math.max(coordinator?.saved?.version??0,coordinator?.current?.version??0);
      return version||undefined;
    },
    draftScope: checkpoints.controller.physicalScopeKey ?? draftKey,
    reload: async () => {
      if (coordinatorRef.current?.hasUnsavedChanges) throw new Error("正文也有未同步修改，请先在文档顶部处理版本冲突；表格本机草稿会保留。");
      await reloadServer();
    },
    transact: async perform => {
      const coordinator = coordinatorRef.current;
      if (!canEdit || !coordinator || !documentAuth) throw new Error("当前无法编辑表格");
      if (loadingRequest.current) await loadingRequest.current;
      let applied=false;
      const result = await coordinator.externalChange(async saved => {
        const result = await perform(saved.version);
        applied=result.content_version>saved.version;
        return { result, transform: value => result.content_version <= value.version ? value : { ...value, version: result.content_version, blocks: { ...value.blocks, blocks: replaceTableBlock(value.blocks.blocks, result.block) } } };
      });
      if(coordinatorRef.current===coordinator&&coordinator.current){
        const block=indexBlocks(coordinator.current.blocks.blocks).get(result.block.id)?.block;
        if(applied&&block?.type==="dataTable"&&block.props.table_id===result.table_id)contentHandle.current?.hydratePayload(block);
        // Existing cursors retain their original read snapshot across local table commits.
        setDraft(coordinator.current);
        if(coordinator.saved)cacheDocumentCommit(queryClient,{document_id:noteId,content_version:coordinator.saved.version,title:coordinator.saved.title});
      }
      return result;
    },
  }), [noteId, documentAuth, canEdit, editorBusy, checkpoints.controller, draftKey, Boolean(draft),tableWriters]);

  const copyPort=useMemo<DocumentCopyPort>(()=>({
    origin:()=>{
      const version=coordinatorRef.current?.saved?.version;
      return workspace&&version?{workspace_id:workspace.id,document_id:noteId,document_version:version}:null;
    },
    prepare:async()=>{
      const coordinator=coordinatorRef.current;
      if(!coordinator||hydratedNoteRef.current!==draftKey)throw new Error("文档尚未载入，请稍后重试。");
      if(canEdit)await flushCurrentDraft(coordinator);
      else if(coordinator.hasUnsavedChanges)throw new Error("只读文档仍有未同步草稿，请先处理后再复制。");
    },
    stage:copies=>{
      const owner=readOwnerRef.current;
      if(!canEdit||!owner||owner.coordinator!==coordinatorRef.current||hydratedNoteRef.current!==draftKey)throw new Error("文档已变化，请重新选择复制位置。");
      const previous=copies.map(copy=>owner.copies.get(copy.block_id));
      for(const copy of copies)owner.copies.set(copy.block_id,copy);
      return()=>copies.forEach((copy,index)=>{const before=previous[index];if(before)owner.copies.set(copy.block_id,before);else owner.copies.delete(copy.block_id);});
    },
    commit:async()=>{
      const coordinator=coordinatorRef.current;
      if(!coordinator||hydratedNoteRef.current!==draftKey)throw new Error("文档已切换，本机草稿仍保留。");
      await flushCurrentDraft(coordinator);
    },
  }),[draftKey,noteId,workspace?.id,canEdit,tableWriters]);

  if (noteQuery.isError || contentQuery.isError) {
    return <DocumentShell><div className="mx-auto max-w-3xl p-8"><Link to="/documents" className="mt-4 inline-flex text-sm font-semibold">返回文档中心</Link></div></DocumentShell>;
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
    <div className="document-header-actions">{(retainedDraft) || (checkpoints.candidates.length) || (checkpoints.status.status === "failed" && autosaveState !== "saved") || (draft && saveState === "conflict") || (saveState === "error" && !editorError) ? <DraftActions>{retainedDraft ? <section><h3 className="mb-2 text-sm font-semibold">保留的草稿</h3><div className="mt-3 flex flex-wrap gap-2"><Button onClick={()=>{
        const url=URL.createObjectURL(new Blob([JSON.stringify(retainedDraft.record)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download=`orbis-local-draft-${noteId}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
      }}>下载本机草稿</Button></div></section> : null}
{checkpoints.candidates.length ? <section><h3 className="mb-2 text-sm font-semibold">其他窗口的草稿</h3><div className="mt-3 flex flex-wrap gap-2">{checkpoints.candidates.map(record => <Button key={record.scopeKey} size="sm" variant="secondary" disabled={autosaveState !== "saved"} onClick={() => void recoverLocalDraft(record)}>恢复“{record.current.title || "未命名文档"}”（基础版本 {record.saved.version}）</Button>)}<Button size="sm" variant="ghost" onClick={checkpoints.dismissCandidates}>稍后处理</Button></div></section> : null}
{checkpoints.status.status === "failed" && autosaveState !== "saved" ? <section><h3 className="mb-2 text-sm font-semibold">保存副本</h3><Button variant="ghost" onClick={() => void checkpoints.controller.flush().catch(() => {})}>重试保存到本机</Button></section> : null}
{draft && saveState === "conflict" ? <section><h3 className="mb-2 text-sm font-semibold">当前修改</h3><div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" icon={<Download aria-hidden="true" size={14} />} onClick={() => void loadCompleteContent().then(() => navigator.clipboard?.writeText(v2ToMarkdown((coordinatorRef.current?.current ?? draft).blocks.blocks))).catch(() => {})}>复制本地 Markdown</Button><ConfirmAction title="载入服务端版本" description="当前未保存的正文和标题将被服务端版本替换。需要保留时，请先复制本地 Markdown。" confirmLabel="替换本地修改" disabled={restoring || archiving} onConfirm={reloadServer}><Button variant="secondary" icon={<RotateCcw aria-hidden="true" size={14} />}>载入服务端版本</Button></ConfirmAction></div></section> : null}
{saveState === "error" && !editorError ? <section><h3 className="mb-2 text-sm font-semibold">保存修改</h3><div className="mt-3"><Button variant="secondary" icon={<RefreshCw aria-hidden="true" size={14} />} onClick={() => coordinatorRef.current?.retry()}>重试保存</Button></div></section> : null}</DraftActions> : null}
      <span className={`document-save-state is-${saveState}`} role="status" aria-live="polite" aria-atomic="true">
        <StateIcon aria-hidden="true" size={14} className={saveState === "saving" ? "document-save-spinner" : ""} /><span>{canEdit ? checkpointCopy ?? stateCopy.label : "只读"}</span>
      </span>
      <span className="document-header-divider" aria-hidden="true" />
      {canEdit && noteQuery.data ? (releaseFeatures.documentSharing ? <ShareButton notebookId={noteQuery.data.notebook_id!} noteId={noteId} title={draft?.title || noteQuery.data.title} /> : null) : null}
      {releaseFeatures.documentCollaboration && <ActionButton ref={collaborationTriggerRef} type="button" className="document-comment-trigger" aria-label="评论与历史" aria-haspopup="dialog" aria-expanded={collaborationOpen} disabled={!draft || archiving} onClick={() => { setCollaborationMounted(true); setCollaborationSession(value => value + 1); setCollaborationOpen(true); }}><MessageSquare aria-hidden="true" size={16} /><span>评论</span></ActionButton>}
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
            <div className="mb-7 mt-2 flex items-center gap-2 text-xs text-[var(--muted-light)]"><span>{canEdit ? "停手后自动保存" : "只读访问"}</span></div>

            <DocumentCopyContext.Provider value={copyPort}><TableHostContext.Provider value={tableHost}><EditorErrorBoundary key={noteId}>
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
            </EditorErrorBoundary></TableHostContext.Provider></DocumentCopyContext.Provider>
            {hasMoreContent ? <div ref={loadMoreTarget} className="document-load-more" aria-live="polite">
              {loadingMore ? <LoadingState label="正在载入后续正文…" compact /> : null}

              {!loadingMore ? <Button variant="ghost" onClick={() => void loadMoreContent().catch(() => {})}>继续阅读</Button> : null}
            </div> : null}
          </article>
        </EditorLayout>
      )}
      {collaborationMounted ? <Suspense fallback={collaborationOpen ? <LoadingState label="正在加载评论与历史…" compact /> : null}>{releaseFeatures.documentCollaboration && <DocumentCollaborationPanel key={`${noteId}:${collaborationSession}`} open={collaborationOpen} noteId={noteId} currentUserId={currentUserId} canManage={canEdit} onClose={closeCollaboration} onRestore={restoreSavedRevision} onPrepareVersion={async () => { const coordinator = coordinatorRef.current; if (!coordinator || !canEdit || restoringRef.current || archivingRef.current) throw new Error("当前草稿尚未准备好。"); return (await flushCurrentDraft(coordinator)).version; }} />}</Suspense> : null}
    </DocumentShell>
  );
}
