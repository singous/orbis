import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import { Dropdown } from "@heroui/react/dropdown";
import { Input as HeroInput } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { ActionButton } from "../../../shared/ui/ActionButton";
import { Button } from "../../../shared/ui/Button";
import { LoadingState } from "../../../shared/ui/LoadingState";
import { StatusMessage } from "../../../shared/ui/StatusMessage";
import { AlertTriangle, Archive, BookOpen, Check, ChevronRight, Cloud, Download, MessageSquare, MoreHorizontal, RefreshCw, WifiOff } from "../../../shared/ui/icons";
import { ApiError } from "../../../shared/api/api-client";
import { authStore } from "../../../shared/auth/auth-store";
import { useOptionalAuthRequest } from "../../../shared/auth/use-auth-request";
import { registerPendingNavigation } from "../../../shared/navigation/pending-navigation";
import { newUUID } from "../../../shared/ids";
import { canMutateWorkspaceContent } from "../../workspace/capabilities";
import { ShareButton } from "../../sharing/ShareButton";
import { TableHostContext, type PendingTableWriter, type TableHost } from "../../data-tables/context";
import type { RestoreSavedRevision } from "../../collaboration/DocumentCollaborationPanel";
import { v2ToMarkdown, type NoteBlocksV2 } from "../../content/model/blocks";
import { DocumentShell } from "../DocumentShell";
import { cacheDocumentCommit } from "../document-cache";
import { getNote, saveNoteBlockChanges } from "../api";
import { useArchiveNote, useNote, useNotebook, useSaveNoteContent } from "../queries";
import { DocumentCopyContext, type DocumentCopyPort } from "./blocks/block-copy-context";
import { indexBlocks } from "./blocks/block-tree";
import { EditorLayout, EditorOutlineStore } from "./EditorLayout";
import { LegacyDocumentEditorPage } from "./DocumentEditorPage";
import { loadDocumentEditor } from "./editor-module";
import { fromTiptapDocument } from "./tiptap-model";
import type { EditorContentHandle } from "./editor-content-handle";
import { getDocumentCollaboration } from "./collaboration-api";
import { DocumentCollaborationProvider, type CollaborationProviderSnapshot } from "./collaboration-provider";
import type { CollaborationCheckpoint } from "./collaboration-persistence";
import { checkpointRecoveryIssue, draftScopeKey, type DraftCheckpoint } from "./draft-checkpoints";
import { useDraftCheckpoints } from "./use-draft-checkpoints";
import { DocumentWriter, type PendingDocumentWrite } from "./document-writer";
import { createEditorDraftFingerprint, type EditorDraft } from "./editor-draft";
import { createBlockChanges } from "./block-changes";
import { hasPendingContent } from "./content-window";
import { resolveTableCopies, type TableCopyIntent } from "./table-copy";

const TiptapEditor = lazy(loadDocumentEditor);
const DocumentCollaborationPanel = lazy(() => import("../../collaboration/DocumentCollaborationPanel").then(module => ({ default: module.DocumentCollaborationPanel })));
const EMPTY_SNAPSHOT: CollaborationProviderSnapshot = { status: "initializing", contentVersion: 0, pendingCount: 0, isSaved: false, readOnly: true, error: null, recoveries: [] };
const emptySnapshot = () => EMPTY_SNAPSHOT;
const noSubscribe = () => () => {};
const TITLE_SAVE_DELAY_MS = 750;
type TitleStatus = "saved" | "dirty" | "saving" | "error" | "conflict";
type Recovery = { record: DraftCheckpoint; source: "legacy" | "metadata"; owned: boolean };
const normalizedTitle = (value: string) => value.trim() || "未命名文档";
function message(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function download(name: string, value: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
class EditorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <StatusMessage tone="error" title="编辑器加载失败">文档内容暂时无法在编辑器中打开。请刷新重试，或返回文档中心。</StatusMessage> : this.props.children; }
}

/** The collaborative body has one Y.Doc owner. Legacy JSON paging and body
 * writes remain confined to the legacy page and explicit draft recovery. */
export default function CollaborativeDocumentEditorPage() {
  const { noteId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const workspace = useStore(authStore, state => state.workspace);
  const userId = useStore(authStore, state => state.user?.id ?? "");
  const canEdit = canMutateWorkspaceContent(workspace);
  const auth = useOptionalAuthRequest();
  const authRef = useRef(auth); authRef.current = auth;
  const noteQuery = useNote(noteId);
  const notebook = useNotebook(noteQuery.data?.notebook_id).data;
  const archiveNote = useArchiveNote();
  const legacySave = useSaveNoteContent();
  const draftKey = draftScopeKey({ origin: new URL(import.meta.env.VITE_API_BASE_URL || "/api", window.location.origin).href, userId, workspaceId: workspace?.id ?? "", noteId });
  const legacyDrafts = useDraftCheckpoints(draftKey);
  const metadataDrafts = useDraftCheckpoints(`${draftKey}:collaboration-metadata`);
  const [recoveries, setRecoveries] = useState<Recovery[]>([]);
  const [provider, setProvider] = useState<DocumentCollaborationProvider | null>(null);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const freshLaneRequested = useRef(false);
  const providerRef = useRef<DocumentCollaborationProvider | null>(null);
  const sessionRef = useRef<object | null>(null);
  const state = useSyncExternalStore(provider?.subscribe ?? noSubscribe, provider?.getSnapshot ?? emptySnapshot, emptySnapshot);
  const [initialBlocks, setInitialBlocks] = useState<NoteBlocksV2 | null>(null);
  const [title, setTitle] = useState(noteQuery.data?.title ?? "");
  const titleRef = useRef(title), savedTitle = useRef(title);
  const metadataVersion = useRef(noteQuery.data?.content_version ?? 0);
  const [titleStatus, setTitleStatus] = useState<TitleStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [collaborationOpen, setCollaborationOpen] = useState(Boolean(searchParams.get("comment")));
  const collaborationTrigger = useRef<HTMLButtonElement>(null);
  const contentHandle = useRef<EditorContentHandle | null>(null);
  const outlineStore = useMemo(() => new EditorOutlineStore(), [noteId]);
  const tableWriters = useMemo(() => new Map<string, PendingTableWriter>(), [draftKey]);
  const copies = useMemo(() => new Map<string, TableCopyIntent>(), [draftKey]);
  const titlePending = useRef<PendingDocumentWrite | null>(null);
  const titleTask = useRef<Promise<void> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const flushRef = useRef<() => Promise<number>>(async () => 0);
  const saveTitleRef = useRef<() => Promise<void>>(async () => {});
  const editability = useRef(canEdit); editability.current = canEdit;
  const readOnly = !canEdit || state.readOnly || busy;
  const metadataRecovery = recoveries.some(item => item.source === "metadata" && item.owned);

  function bodySnapshot(): NoteBlocksV2 {
    const current = providerRef.current;
    if (!current) throw new Error("正文尚未准备好，请稍后重试。");
    return contentHandle.current?.snapshot() ?? fromTiptapDocument(yDocToProsemirrorJSON(current.doc, "body"));
  }
  function assertSession(current: DocumentCollaborationProvider) {
    if (providerRef.current !== current) throw new DOMException("The current document changed", "AbortError");
  }
  function completeTableCopies(blocks: NoteBlocksV2) {
    if (!copies.size) return;
    const live = indexBlocks(blocks.blocks);
    for (const [id, copy] of copies) {
      const block = live.get(id)?.block;
      if (!block || block.type !== "dataTable" || block.props.table_id !== copy.source.table_id) copies.delete(id);
    }
  }
  function serializeNative<T>(perform: () => Promise<T>): Promise<T> {
    const task = nativeQueue.current.catch(() => {}).then(perform);
    nativeQueue.current = task.catch(() => {});
    return task;
  }
  async function synchronize(current: DocumentCollaborationProvider) {
    const credentials = authRef.current;
    if (!credentials) throw new Error("请重新登录后继续同步文档。");
    const fresh = await getDocumentCollaboration(noteId, credentials);
    assertSession(current);
    await current.synchronize(fresh);
    return fresh.content_version;
  }
  function checkpointTitle() {
    const current = providerRef.current;
    if (!current || metadataRecovery) return;
    const blocks = bodySnapshot(), version = titlePending.current?.expected_version ?? current.getSnapshot().contentVersion;
    const saved = { title: savedTitle.current, blocks, version }, desired = { title: titleRef.current, blocks, version }, pending = titlePending.current;
    metadataDrafts.controller.schedule(() => ({ saved, current: desired, window: null, descriptors: [], pending }));
  }

  useEffect(() => {
    const identity = {}; sessionRef.current = identity;
    const abort = new AbortController();
    let current: DocumentCollaborationProvider | null = null;
    setProvider(null); setInitialBlocks(null); setError(null); setFallback(false); setRecoveries([]);
    titlePending.current = null; titleTask.current = null;
    metadataVersion.current = noteQuery.data?.content_version ?? 0;
    nativeQueue.current = Promise.resolve();
    const credentials = authRef.current;
    if (!credentials || !workspace?.id || !userId) return;
    void (async () => {
      try {
        const initial = await getDocumentCollaboration(noteId, credentials, { activate: canEdit, signal: abort.signal });
        if (abort.signal.aborted) return;
        current = new DocumentCollaborationProvider({ documentId: noteId, workspaceId: workspace.id, userId, initialState: initial, readOnly: !canEdit,
          laneOptions: freshLaneRequested.current ? { storage: { getItem: () => null, setItem: (key, value) => window.sessionStorage.setItem(key, value) } } : undefined,
          token: () => authStore.getState().accessToken ?? "",
          refreshToken: async signal => {
            const latest = authRef.current;
            if (!latest) return null;
            await getNote(noteId, latest, signal);
            return authStore.getState().accessToken;
          },
          onForbidden: () => { void noteQuery.refetch(); },
        });
        freshLaneRequested.current = false;
        await current.start();
        if (abort.signal.aborted) { await current.dispose(); return; }
        const [legacy, metadata] = await Promise.all([legacyDrafts.controller.read(), metadataDrafts.controller.read()]);
        if (abort.signal.aborted) { await current.dispose(); return; }
        const changed = (record: DraftCheckpoint | null) => record && (record.pending || createEditorDraftFingerprint()(record.saved) !== createEditorDraftFingerprint()(record.current));
        setRecoveries([...(changed(legacy) ? [{ record: legacy!, source: "legacy" as const, owned: true }] : []), ...(changed(metadata) ? [{ record: metadata!, source: "metadata" as const, owned: true }] : [])]);
        const blocks = fromTiptapDocument(yDocToProsemirrorJSON(current.doc, "body"));
        const initialTitle = noteQuery.data?.title ?? "未命名文档";
        savedTitle.current = titleRef.current = initialTitle; setTitle(initialTitle); setTitleStatus("saved");
        providerRef.current = current; setInitialBlocks(blocks); outlineStore.reset(); outlineStore.update(blocks); setProvider(current);
      } catch (cause) {
        if (abort.signal.aborted) return;
        if (!canEdit && cause instanceof ApiError && cause.code === "COLLABORATION_NOT_ENABLED") { setFallback(true); return; }
        if (current && current.getSnapshot().status === "recovery") {
          let blocks: NoteBlocksV2 = { schema_version: 2, editor: "blocknote", blocks: [] };
          try { blocks = fromTiptapDocument(yDocToProsemirrorJSON(current.doc, "body")); }
          catch { /* The original binary remains downloadable if rendering fails. */ }
          const initialTitle = noteQuery.data?.title ?? "未命名文档";
          savedTitle.current = titleRef.current = initialTitle; setTitle(initialTitle); setTitleStatus("saved");
          providerRef.current = current; setInitialBlocks(blocks); outlineStore.reset(); outlineStore.update(blocks); setProvider(current);
        }
        setError(message(cause, "文档协作状态未能载入，请重试。"));
      }
    })();
    return () => {
      abort.abort();
      if (sessionRef.current === identity) sessionRef.current = null;
      if (titleTimer.current !== null) { clearTimeout(titleTimer.current); titleTimer.current = null; }
      if (metadataRefreshTimer.current !== null) { clearTimeout(metadataRefreshTimer.current); metadataRefreshTimer.current = null; }
      if (providerRef.current === current) providerRef.current = null;
      contentHandle.current = null;
      if (current) void current.dispose().catch(() => {});
    };
  }, [draftKey, noteId, canEdit, sessionGeneration, legacyDrafts.controller, metadataDrafts.controller]);

  useEffect(() => {
    const additions: Recovery[] = [...legacyDrafts.candidates.map(record => ({ record, source: "legacy" as const, owned: false })), ...metadataDrafts.candidates.map(record => ({ record, source: "metadata" as const, owned: false }))];
    if (additions.length) setRecoveries(previous => [...previous,
      ...additions.filter(item => !previous.some(existing => existing.record.scopeKey === item.record.scopeKey)),
    ]);
  }, [legacyDrafts.candidates, metadataDrafts.candidates]);
  useEffect(() => { setCollaborationOpen(Boolean(searchParams.get("comment"))); }, [noteId, searchParams.get("comment")]);

  // Directory renames can populate the query cache before the socket update.
  // Accept only current metadata and leave unsaved local title intent intact.
  useEffect(() => {
    const note = noteQuery.data;
    if (!provider || !note || note.content_version < Math.max(metadataVersion.current, state.contentVersion)) return;
    metadataVersion.current = note.content_version;
    if (!titlePending.current && normalizedTitle(titleRef.current) === normalizedTitle(savedTitle.current)) {
      savedTitle.current = titleRef.current = note.title; setTitle(note.title);
    }
  }, [provider, noteQuery.data?.title, noteQuery.data?.content_version, state.contentVersion]);

  // Native metadata changes share the body version. Refresh the small metadata
  // projection after a durable remote update without resetting the editor.
  useEffect(() => {
    if (!provider || state.contentVersion <= (noteQuery.data?.content_version ?? 0) || metadataRefreshTimer.current !== null) return;
    metadataRefreshTimer.current = setTimeout(() => {
      metadataRefreshTimer.current = null;
      const credentials = authRef.current;
      if (!credentials) return;
      void getNote(noteId, credentials).then(note => {
        if (providerRef.current !== provider) return;
        queryClient.setQueryData<NonNullable<typeof noteQuery.data>>(["note", noteId], previous =>
          previous && previous.content_version > note.content_version ? previous : note);
      }).catch(() => {});
    }, TITLE_SAVE_DELAY_MS);
  }, [provider, state.contentVersion, noteQuery.data?.content_version, noteId]);
  async function saveTitleNow() {
    if (titleTask.current) return titleTask.current;
    const current = providerRef.current;
    if (!current || !editability.current || current.getSnapshot().readOnly) throw new Error("当前文档无法保存标题，本机草稿仍保留。");
    const identity = sessionRef.current;
    const task = serializeNative(async () => {
      do {
        await current.flush(); assertSession(current);
        const credentials = authRef.current;
        if (!credentials) throw new Error("请重新登录后继续保存标题。");
        if (!titlePending.current && normalizedTitle(titleRef.current) === normalizedTitle(savedTitle.current)) { await synchronize(current); setTitleStatus("saved"); return; }
        if (!titlePending.current) {
          // A peer's socket version can arrive before its metadata projection.
          // Check the title baseline before assigning this new write a version.
          const fresh = await getNote(noteId, credentials); assertSession(current);
          if (normalizedTitle(fresh.title) !== normalizedTitle(savedTitle.current) && normalizedTitle(fresh.title) !== normalizedTitle(titleRef.current)) {
            throw new ApiError(409, "标题已被其他作者修改，本机标题仍保留。请载入服务端标题后再编辑。", "DOCUMENT_VERSION_CONFLICT");
          }
          const version = fresh.content_version, blocks = bodySnapshot();
          titlePending.current = { format_version: 1, document_id: noteId, operation_id: newUUID(), expected_version: version, kind: "commands", operations: [{ type: "update_metadata", title: normalizedTitle(titleRef.current) }], submitted: { title: titleRef.current, blocks, version }, uncertain: false };
        }
        const pending = titlePending.current;
        const base: EditorDraft = { ...pending.submitted, title: savedTitle.current };
        await metadataDrafts.controller.checkpoint({ saved: base, current: pending.submitted, window: null, descriptors: [], pending }).catch(() => {});
        const checkpointSequence = metadataDrafts.controller.sequence;
        setTitleStatus("saving");
        const result = await saveNoteBlockChanges({ noteId, operationId: pending.operation_id, expectedVersion: pending.expected_version, operations: pending.operations }, credentials);
        assertSession(current);
        savedTitle.current = result.title;
        cacheDocumentCommit(queryClient, { document_id: noteId, content_version: result.content_version, title: result.title });
        await synchronize(current);
        // An idempotent receipt can confirm an earlier title after a peer has
        // already renamed the document. Keep later local input dirty; otherwise
        // display the current server title after confirming the original write.
        const fresh = await getNote(noteId, credentials); assertSession(current);
        const cached = queryClient.getQueryData<NonNullable<typeof noteQuery.data>>(["note", noteId]);
        const latest = cached && cached.content_version > fresh.content_version ? cached : fresh;
        queryClient.setQueryData(["note", noteId], latest);
        if (normalizedTitle(titleRef.current) === normalizedTitle(pending.submitted.title)) {
          metadataVersion.current = Math.max(metadataVersion.current, latest.content_version);
          savedTitle.current = titleRef.current = latest.title; setTitle(latest.title);
        }
        titlePending.current = null;
        await metadataDrafts.controller.acknowledge(checkpointSequence).catch(() => {});
      } while (normalizedTitle(titleRef.current) !== normalizedTitle(savedTitle.current));
      setTitleStatus("saved"); setError(null);
    }).catch(cause => {
      if (sessionRef.current === identity) {
        if (titlePending.current) titlePending.current.uncertain ||= !(cause instanceof ApiError) || cause.status >= 500;
        setTitleStatus(cause instanceof ApiError && cause.isConflict ? "conflict" : "error");
        setError(message(cause, "标题尚未保存，本机草稿仍保留。"));
        checkpointTitle();
      }
      throw cause;
    }).finally(() => { if (titleTask.current === task) titleTask.current = null; });
    titleTask.current = task;
    return task;
  }
  saveTitleRef.current = saveTitleNow;
  function changeTitle(value: string) {
    if (readOnly || metadataRecovery) return;
    titleRef.current = value; setTitle(value); setTitleStatus("dirty"); checkpointTitle();
    if (titleTimer.current !== null) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => { titleTimer.current = null; void saveTitleRef.current().catch(() => {}); }, TITLE_SAVE_DELAY_MS);
  }
  async function flushEverything() {
    const current = providerRef.current;
    if (!current) throw new Error("正文尚未准备好，请稍后重试。");
    if (editorError) throw new Error(editorError);
    await current.flush(); assertSession(current);
    if (normalizedTitle(titleRef.current) !== normalizedTitle(savedTitle.current) || titlePending.current || titleStatus === "error" || titleStatus === "conflict") await saveTitleRef.current();
    for (const writer of [...tableWriters.values()]) if (writer.hasPending()) await writer.flush();
    const version = await current.flush(); assertSession(current);
    if (copies.size) {
      await synchronize(current);
      completeTableCopies(bodySnapshot());
      if (copies.size) throw new Error("表格复制结果尚未同步，请重试。当前草稿仍保留。");
    }
    if (!current.getSnapshot().isSaved || titlePending.current || normalizedTitle(titleRef.current) !== normalizedTitle(savedTitle.current) || [...tableWriters.values()].some(writer => writer.hasPending())) throw new Error("当前草稿尚未成功保存，请等待同步完成。本机草稿仍保留。");
    return Math.max(version, current.getSnapshot().contentVersion);
  }
  flushRef.current = flushEverything;
  useEffect(() => registerPendingNavigation(async () => {
    if (busyRef.current) throw new Error("当前文档正在恢复或归档，请稍后再打开其他内容。");
    if (!providerRef.current) return;
    await flushRef.current();
  }), [draftKey]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = providerRef.current;
      if (busyRef.current || (current && !current.getSnapshot().isSaved) || titlePending.current || normalizedTitle(titleRef.current) !== normalizedTitle(savedTitle.current)) {
        event.preventDefault();
        void metadataDrafts.controller.flush().catch(() => {});
        if (current) void current.flush().catch(() => {});
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [draftKey, metadataDrafts.controller]);

  async function performBusy(perform: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try { await perform(); }
    catch (cause) { setError(message(cause, "操作未完成，本机草稿仍保留。")); throw cause; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function restoreSavedRevision(restore: RestoreSavedRevision) {
    if (readOnly) throw new Error("当前无法恢复文档。");
    await performBusy(async () => {
      await flushEverything();
      await serializeNative(async () => {
        const current = providerRef.current!;
        const version = await current.flush();
        const restored = await restore(version); assertSession(current);
        if (restored.title !== null) { savedTitle.current = titleRef.current = restored.title; setTitle(restored.title); }
        cacheDocumentCommit(queryClient, { document_id: noteId, content_version: restored.content_version, title: restored.title });
        // Explicit history restore begins a new collaboration epoch. All local
        // writes were acknowledged above, so open that durable state afresh.
        contentHandle.current = null;
        setSessionGeneration(value => value + 1);
      });
    });
  }
  async function archive() {
    if (readOnly || !noteQuery.data) return;
    await performBusy(async () => {
      await flushEverything();
      if (!notebook) throw new Error("目录版本尚未载入，请重新载入。");
      await archiveNote.mutateAsync({ id: noteId, archived: true, expected_directory_version: notebook.directory_version });
      navigate(`/collections/${noteQuery.data!.notebook_id}`, { replace: true });
    });
  }
  async function recover(entry: Recovery) {
    if (readOnly) return;
    const issue = checkpointRecoveryIssue(entry.record, noteId);
    if (issue) { setError(issue); return; }
    await performBusy(async () => {
      await flushEverything();
      const controller = entry.source === "legacy" ? legacyDrafts.controller : metadataDrafts.controller;
      let saved = entry.record.saved;
      let desired = entry.record.current;
      const complete = (!entry.record.window || !entry.record.window.hasMore) && !hasPendingContent(new Map(entry.record.descriptors));
      const writer = new DocumentWriter({ documentId: noteId, write: pending => legacySave.mutateAsync(pending), onResolved: (copied, resolved, version) => { desired = resolveTableCopies(desired, copied, resolved, version); }, checkpoint: async (pending, flush) => {
        controller.schedule(() => ({ saved, current: desired, window: entry.record.window, descriptors: entry.record.descriptors, pending }));
        if (flush) await controller.flush();
      } });
      writer.restore(entry.record.pending);
      await serializeNative(async () => {
        const fingerprint = createEditorDraftFingerprint();
        do {
          saved = await writer.save({ ...desired, version: saved.version }, saved, complete, createBlockChanges()(saved.blocks, desired.blocks));
        } while (fingerprint(saved) !== fingerprint(desired));
        await synchronize(providerRef.current!);
        const credentials = authRef.current!;
        const note = await getNote(noteId, credentials);
        savedTitle.current = titleRef.current = note.title; setTitle(note.title); setTitleStatus("saved");
        queryClient.setQueryData(["note", noteId], note);
        await controller.acknowledge(controller.sequence);
        setRecoveries(previous => previous.filter(item => item.record.scopeKey !== entry.record.scopeKey));
      });
    });
  }
  async function discardRecovery(entry: Recovery) {
    if (entry.owned) {
      const controller = entry.source === "legacy" ? legacyDrafts.controller : metadataDrafts.controller;
      await controller.acknowledge(controller.sequence);
    }
    setRecoveries(previous => previous.filter(item => item.record.scopeKey !== entry.record.scopeKey));
  }
  function downloadLegacyMarkdown(entry: Recovery) {
    try { download(`${normalizedTitle(entry.record.current.title)}.md`, v2ToMarkdown(entry.record.current.blocks.blocks), "text/markdown"); }
    catch { setError("此草稿暂不能导出 Markdown，请下载完整草稿后恢复。"); }
  }
  function downloadCollaborationMarkdown(checkpoint: CollaborationCheckpoint) {
    const recovered = new Y.Doc();
    try {
      Y.applyUpdate(recovered, checkpoint.state);
      const blocks = fromTiptapDocument(yDocToProsemirrorJSON(recovered, "body"));
      download(`orbis-recovered-${noteId}-v${checkpoint.contentVersion}.md`, v2ToMarkdown(blocks.blocks), "text/markdown");
    } catch { setError("此草稿暂不能导出 Markdown，请下载完整恢复副本后恢复。"); }
    finally { recovered.destroy(); }
  }
  async function openServerKeepingRecovery() {
    if (!canEdit || providerRef.current?.getSnapshot().status !== "recovery") return;
    await performBusy(async () => {
      const current = providerRef.current, credentials = authRef.current;
      if (!current || !credentials) throw new Error("请重新登录后载入服务端版本。");
      // Keep the old lane and its original operation IDs before changing owners.
      await current.saveRecovery();
      const metadata = await getNote(noteId, credentials); assertSession(current);
      queryClient.setQueryData(["note", noteId], metadata);
      freshLaneRequested.current = true;
      contentHandle.current = null;
      setSessionGeneration(value => value + 1);
    });
  }
  async function reloadServerTitle() {
    if (titleStatus !== "conflict" || titlePending.current?.uncertain) return;
    await performBusy(async () => {
      const current = providerRef.current, credentials = authRef.current;
      if (!current || !credentials) throw new Error("请重新登录后载入标题。");
      await current.flush();
      const note = await getNote(noteId, credentials); assertSession(current);
      savedTitle.current = titleRef.current = note.title; titlePending.current = null;
      setTitle(note.title); setTitleStatus("saved");
      queryClient.setQueryData(["note", noteId], note);
      await metadataDrafts.controller.acknowledge(metadataDrafts.controller.sequence);
    });
  }

  const tableHost = useMemo<TableHost>(() => ({ noteId, auth, readOnly, canRecoverDraft: canEdit, draftScope: draftKey,
    registerWriter: (id, writer) => { tableWriters.set(id, writer); return () => { if (tableWriters.get(id) === writer) tableWriters.delete(id); }; },
    isCopyPending: id => copies.has(id),
    documentVersion: () => providerRef.current?.getSnapshot().contentVersion,
    reload: async () => { const current = providerRef.current; if (current) { await current.flush(); await synchronize(current); } },
    transact: perform => serializeNative(async () => {
      const current = providerRef.current;
      if (!current || !editability.current || current.getSnapshot().readOnly) throw new Error("当前无法编辑表格。");
      const version = await current.flush();
      const result = await perform(version); assertSession(current);
      await synchronize(current);
      return result;
    }),
  }), [noteId, auth, readOnly, canEdit, draftKey, tableWriters, copies]);
  const copyPort = useMemo<DocumentCopyPort>(() => ({
    origin: () => { const current = providerRef.current; return workspace && current ? { workspace_id: workspace.id, document_id: noteId, document_version: current.getSnapshot().contentVersion } : null; },
    prepare: async () => { await flushRef.current(); },
    stage: values => {
      const current = providerRef.current;
      if (!current || !editability.current || current.getSnapshot().readOnly) throw new Error("当前无法复制表格。");
      const rollback = current.stageTableCopies(values);
      const previous = values.map(value => copies.get(value.block_id));
      for (const value of values) copies.set(value.block_id, value);
      return () => { rollback(); values.forEach((value, index) => { const before = previous[index]; if (before) copies.set(value.block_id, before); else copies.delete(value.block_id); }); };
    },
    commit: async () => { await flushRef.current(); },
  }), [workspace?.id, noteId, copies]);

  if (fallback) return <LegacyDocumentEditorPage />;
  const saved = state.isSaved && titleStatus === "saved";
  const saveError = titleStatus === "error" || Boolean(editorError || state.error);
  const StateIcon = state.status === "offline" ? WifiOff : state.status === "recovery" || titleStatus === "conflict" ? AlertTriangle : saveError ? WifiOff : saved ? Check : state.pendingCount || titleStatus === "saving" ? RefreshCw : Cloud;
  const saveLabel = !canEdit ? "只读" : titleStatus === "conflict" ? "标题版本冲突" : state.status === "offline" ? "离线，本机草稿已保留" : state.status === "recovery" ? "本机草稿需要恢复" : saveError ? "保存失败" : saved ? "已保存" : "保存中…";
  const breadcrumb = <nav className="document-breadcrumb" aria-label="文档位置"><Link to={noteQuery.data ? `/collections/${noteQuery.data.notebook_id}` : "/documents"} title={notebook?.title ?? "笔记本"}><BookOpen aria-hidden="true" size={15} /><span>{notebook?.title ?? "笔记本"}</span></Link><ChevronRight aria-hidden="true" size={13} /><span aria-current="page" title={title || "未命名文档"}>{title || "未命名文档"}</span></nav>;
  const toolbar = <div className="document-header-actions"><span className={`document-save-state is-${saved ? "saved" : error ? "error" : "saving"}`} role="status" aria-live="polite" aria-atomic="true"><StateIcon aria-hidden="true" size={14} className={!saved && StateIcon === RefreshCw ? "document-save-spinner" : ""} /><span>{saveLabel}</span></span><span className="document-header-divider" aria-hidden="true" />{canEdit && noteQuery.data ? <ShareButton notebookId={noteQuery.data.notebook_id!} noteId={noteId} title={title || noteQuery.data.title} /> : null}<ActionButton ref={collaborationTrigger} type="button" className="document-comment-trigger" aria-label="评论与历史" aria-haspopup="dialog" aria-expanded={collaborationOpen} disabled={!provider || busy} onClick={() => setCollaborationOpen(true)}><MessageSquare aria-hidden="true" size={16} /><span>评论</span></ActionButton>{canEdit ? <Dropdown><ActionButton type="button" className="icon-button" aria-label="更多文档操作" disabled={!provider || busy}><MoreHorizontal aria-hidden="true" size={18} /></ActionButton><Dropdown.Popover placement="bottom end" className="document-actions-popover" offset={6}><Dropdown.Menu aria-label="文档操作" onAction={key => { if (key === "archive") void archive().catch(() => {}); }}><Dropdown.Item id="archive" textValue="归档文档" isDisabled={!provider || busy}><Archive aria-hidden="true" size={16} /><Label>归档文档</Label></Dropdown.Item></Dropdown.Menu></Dropdown.Popover></Dropdown> : null}</div>;
  return <DocumentShell editorLayout breadcrumb={breadcrumb} toolbar={toolbar} notebookId={noteQuery.data?.notebook_id} activeNoteId={noteId}>
    {!provider || !initialBlocks ? <div className="page-container">{error ? <StatusMessage tone="error" title="无法打开文档">{error}<div className="mt-3"><Button onClick={() => window.location.reload()}>重新载入</Button></div></StatusMessage> : <LoadingState label="正在打开文档…" variant="editor" />}</div> : <EditorLayout outlineStore={outlineStore}><article className="editor-canvas">
      <HeroInput aria-label="文档标题" className="orbis-embedded-input editor-title" placeholder="无标题" value={title} readOnly={readOnly || metadataRecovery} onChange={event => changeTitle(event.target.value)} />
      <div className="mb-7 mt-2 flex items-center gap-2 text-xs text-[var(--muted-light)]"><span>版本 {state.contentVersion}</span><span>·</span><span>{canEdit ? "修改自动同步，多人实时协作" : "只读访问"}</span></div>
      {recoveries.length ? <StatusMessage tone="warning" title="检测到保留的本机草稿">原草稿会保留，恢复时会核对版本。<div className="mt-3 flex flex-wrap gap-2">{recoveries.map(entry => <div key={entry.record.scopeKey} className="flex flex-wrap items-center gap-2"><span>“{entry.record.current.title || "未命名文档"}”（基础版本 {entry.record.saved.version}）</span><Button size="sm" disabled={readOnly || recoveries.some(other => other.source === entry.source && other.owned && other.record.scopeKey !== entry.record.scopeKey)} onClick={() => void recover(entry).catch(() => {})}>恢复草稿</Button><Button size="sm" variant="secondary" onClick={() => download(`orbis-local-draft-${noteId}.json`, JSON.stringify(entry.record))}>下载完整草稿</Button><Button size="sm" variant="secondary" onClick={() => downloadLegacyMarkdown(entry)}>下载 Markdown</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void discardRecovery(entry).catch(cause => setError(message(cause, "本机草稿暂未清除。")))}>{entry.owned ? "放弃此草稿" : "稍后处理"}</Button></div>)}</div></StatusMessage> : null}
      {state.recoveries.length || state.status === "recovery" ? <StatusMessage tone="warning" title="本机协作草稿需要手动恢复">本机保留了尚未合入当前版本的修改。可先下载查看，再保留草稿并继续编辑服务端版本。<div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={() => download(`orbis-collaboration-recovery-${noteId}.json`, provider.exportRecovery())}>下载本机草稿</Button>{state.recoveries.map((checkpoint, index) => <Button key={checkpoint.epoch + "-" + index} variant="secondary" onClick={() => downloadCollaborationMarkdown(checkpoint)}>下载草稿 Markdown（版本 {checkpoint.contentVersion}）</Button>)}{canEdit && state.status === "recovery" ? <Button variant="secondary" disabled={busy} onClick={() => void openServerKeepingRecovery().catch(() => {})}>保留本机草稿并载入服务端</Button> : !canEdit ? <Button variant="ghost" onClick={() => window.location.reload()}>重新载入</Button> : null}</div></StatusMessage> : null}
      {error || editorError || state.error ? <div className="mb-5"><StatusMessage tone="error" title="文档尚未完成保存">{editorError ?? error ?? state.error}<div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" icon={<RefreshCw aria-hidden="true" size={14} />} disabled={state.readOnly || busy} onClick={() => void flushEverything().then(() => setError(null)).catch(cause => setError(message(cause, "保存确认尚未收到。")))}>重试保存</Button>{titleStatus === "conflict" ? <Button variant="secondary" disabled={busy} onClick={() => void reloadServerTitle().catch(() => {})}>载入服务端标题</Button> : null}<Button variant="secondary" icon={<Download aria-hidden="true" size={14} />} onClick={() => download(`${normalizedTitle(title)}.md`, v2ToMarkdown(bodySnapshot().blocks), "text/markdown")}>下载本地 Markdown</Button><Button variant="ghost" onClick={() => download(`orbis-collaboration-recovery-${noteId}.json`, provider.exportRecovery())}>下载完整恢复副本</Button></div></StatusMessage></div> : null}
      {metadataDrafts.status.status === "failed" ? <StatusMessage tone="warning" title="本机标题草稿尚未持久保存">浏览器存储暂不可用，请保持页面打开并重试同步。<Button variant="ghost" onClick={() => void metadataDrafts.controller.flush().catch(() => {})}>重试保存到本机</Button></StatusMessage> : null}
      <DocumentCopyContext.Provider value={copyPort}><TableHostContext.Provider value={tableHost}><EditorBoundary key={draftKey}><Suspense fallback={<LoadingState label="正在准备编辑…" variant="editor-body" delayMs={180} />}><TiptapEditor noteId={noteId} blocks={initialBlocks} collaborationDoc={provider.doc} readOnly={readOnly} onContentReady={handle => { contentHandle.current = handle; }} onError={setEditorError} onChange={({ blocks }) => { completeTableCopies(blocks); outlineStore.update(blocks); }} /></Suspense></EditorBoundary></TableHostContext.Provider></DocumentCopyContext.Provider>
    </article></EditorLayout>}
    {collaborationOpen ? <Suspense fallback={<LoadingState label="正在加载评论与历史…" compact />}><DocumentCollaborationPanel key={noteId} noteId={noteId} currentUserId={userId} canManage={canEdit && !state.readOnly} onClose={() => { if (!busyRef.current) { setCollaborationOpen(false); collaborationTrigger.current?.focus(); } }} onRestore={restoreSavedRevision} /></Suspense> : null}
  </DocumentShell>;
}
