import type { BlockLoadState } from "./content-window";
import { draftLanePrefix } from "./draft-lanes";
export { resolveDraftLane, withDraftLane } from "./draft-lanes";
export type { DraftLaneClaim, DraftLaneOptions } from "./draft-lanes";
import type { EditorDraft } from "./editor-draft";

export type DraftContentWindow = { noteId: string; version: number; next: number; total: number; hasMore: boolean; bounded?: boolean };
export type DraftCheckpoint = { scopeKey: string; saved: EditorDraft; current: EditorDraft; window: DraftContentWindow | null; descriptors: Array<[string, BlockLoadState]>; sequence: number };
export type DraftCheckpointInput = Omit<DraftCheckpoint, "scopeKey" | "sequence">;
export type DraftCheckpointSource = DraftCheckpointInput | (() => DraftCheckpointInput);
export type DraftCheckpointAdapter = {
  read(scopeKey: string): Promise<DraftCheckpoint | null>;
  put(checkpoint: DraftCheckpoint): Promise<void>;
  /** Delete only a record no newer than the server-acknowledged checkpoint. */
  remove(scopeKey: string, throughSequence: number): Promise<void>;
  list?(baseScopeKey: string): Promise<DraftCheckpoint[]>;
};
export type CheckpointStatus = { status: "pending" | "saved" | "cleared" | "failed"; sequence: number; error?: unknown };
const DATABASE_NAME = "orbis-document-drafts", STORE_NAME = "checkpoints", DATABASE_VERSION = 1;
export const DRAFT_CHECKPOINT_DELAY_MS = 250;

export function draftScopeKey(scope: { origin: string; userId: string; workspaceId: string; noteId: string }): string {
  // Length framing prevents collisions even if identifiers contain separators.
  return [scope.origin, scope.userId, scope.workspaceId, scope.noteId].map(value => `${value.length}:${value}`).join("|");
}
function validCheckpoint(value: unknown, scopeKey: string): value is DraftCheckpoint {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DraftCheckpoint>;
  const validDraft = (draft: EditorDraft | undefined) => !!draft && typeof draft.title === "string" && Number.isSafeInteger(draft.version) && draft.version > 0 && draft.blocks?.schema_version === 2 && Array.isArray(draft.blocks.blocks);
  return record.scopeKey === scopeKey && Number.isSafeInteger(record.sequence) && (record.sequence ?? -1) >= 0 && validDraft(record.saved) && validDraft(record.current) && Array.isArray(record.descriptors);
}
/** Native structured cloning happens in IndexedDB after coalescing, not during
 * each editor transaction. Reads and conditional deletes use one transaction. */
export function createIndexedDbDraftAdapter(factory: IDBFactory | undefined = globalThis.indexedDB): DraftCheckpointAdapter {
  let opening: Promise<IDBDatabase> | null = null;
  function database(): Promise<IDBDatabase> {
    if (!factory) return Promise.reject(new Error("浏览器不支持本地草稿存储。"));
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "scopeKey" }); };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
      request.onerror = () => { opening = null; reject(request.error ?? new Error("无法打开本地草稿存储。")); };
      request.onblocked = () => { opening = null; reject(new Error("本地草稿存储升级被其他页面阻挡，请关闭旧页面后重试。")); };
    });
    return opening;
  }
  async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, resolveValue: (value: T) => void) => void): Promise<T> {
    const db = await database();
    return new Promise((resolve, reject) => {
      let value: T;
      const tx = db.transaction(STORE_NAME, mode);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error ?? new Error("本地草稿写入失败。"));
      tx.onabort = () => reject(tx.error ?? new Error("本地草稿写入中断。"));
      try { action(tx.objectStore(STORE_NAME), next => { value = next; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  return {
    list(baseScopeKey) {
      return transaction<DraftCheckpoint[]>("readonly", (store, result) => {
        const records: DraftCheckpoint[] = [];
        const prefix = draftLanePrefix(baseScopeKey);
        const lanes = store.getAll(IDBKeyRange.bound(prefix, prefix + "\uffff"));
        const legacy = store.get(baseScopeKey);
        let remaining = 2;
        const finish = () => { remaining -= 1; if (remaining === 0) result(records); };
        lanes.onsuccess = () => { for (const value of lanes.result) if (typeof value?.scopeKey === "string" && validCheckpoint(value, value.scopeKey)) records.push(value); finish(); };
        legacy.onsuccess = () => { if (validCheckpoint(legacy.result, baseScopeKey)) records.push(legacy.result); finish(); };
      });
    },
    read(scopeKey) { return transaction<DraftCheckpoint | null>("readonly", (store, result) => { const request = store.get(scopeKey); request.onsuccess = () => result(validCheckpoint(request.result, scopeKey) ? request.result : null); }); },
    put(checkpoint) { return transaction<void>("readwrite", (store, result) => { const request = store.get(checkpoint.scopeKey); request.onsuccess = () => { const previous = request.result as DraftCheckpoint | undefined; if (!previous || previous.sequence <= checkpoint.sequence) store.put(checkpoint); result(undefined); }; }); },
    remove(scopeKey, throughSequence) { return transaction<void>("readwrite", (store, result) => { const request = store.get(scopeKey); request.onsuccess = () => { const previous = request.result as DraftCheckpoint | undefined; if (previous && previous.sequence <= throughSequence) store.delete(scopeKey); result(undefined); }; }); },
  };
}
/** One controller belongs to one immutable account/workspace/document scope.
 * Call read before editing to recover its sequence and baseline. A source thunk
 * avoids walking descriptors or materializing editor state on each keystroke. */
export function createDraftCheckpointController(options: { scopeKey: string; adapter?: DraftCheckpointAdapter; delayMs?: number; onStatus?: (event: CheckpointStatus) => void }) {
  const { scopeKey, onStatus } = options;
  const adapter = options.adapter ?? createIndexedDbDraftAdapter();
  const delay = options.delayMs ?? DRAFT_CHECKPOINT_DELAY_MS;
  let sequence = 0, pending: { sequence: number; source: DraftCheckpointSource } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null, disposed = false, queue: Promise<void> = Promise.resolve();
  function clearTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function enqueue(action: () => Promise<void>, operationSequence: number, status: CheckpointStatus["status"]): Promise<void> {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result.then(() => { onStatus?.({ status, sequence: operationSequence }); }, error => { onStatus?.({ status: "failed", sequence: operationSequence, error }); throw error; });
  }
  function flush(): Promise<void> {
    clearTimer();
    const entry = pending;
    if (!entry) return queue;
    pending = null;
    return enqueue(async () => {
      // Capture at the coalesced boundary. Draft trees are immutable; window and
      // descriptors are mutable session metadata and receive shallow copies.
      try {
      const value = typeof entry.source === "function" ? entry.source() : entry.source;
      const checkpoint: DraftCheckpoint = { scopeKey, sequence: entry.sequence, saved: value.saved, current: value.current, window: value.window ? { ...value.window } : null, descriptors: value.descriptors.map(([id, state]) => [id, { ...state }]) };
      await adapter.put(checkpoint); }
      catch (error) { if (!pending || pending.sequence < entry.sequence) pending = entry; throw error; }
    }, entry.sequence, "saved");
  }
  function schedule(source: DraftCheckpointSource): number {
    if (disposed) throw new Error("本地草稿会话已关闭。");
    sequence += 1; pending = { sequence, source }; onStatus?.({ status: "pending", sequence });
    if (timer === null) timer = setTimeout(() => { timer = null; void flush().catch(() => {}); }, delay);
    return sequence;
  }
  return {
    async read(): Promise<DraftCheckpoint | null> { await queue; try { const stored = await adapter.read(scopeKey); if (stored) sequence = Math.max(sequence, stored.sequence); return stored; } catch (error) { onStatus?.({ status: "failed", sequence, error }); throw error; } },
    schedule,
    checkpoint(source?: DraftCheckpointSource): Promise<void> { if (source) schedule(source); return flush(); },
    acknowledge(throughSequence: number): Promise<void> {
      if (pending && pending.sequence <= throughSequence) { pending = null; clearTimer(); }
      // Serialize behind started writes; conditional deletion keeps newer data.
      return enqueue(() => adapter.remove(scopeKey, throughSequence), throughSequence, "cleared");
    },
    flush,
    async dispose(): Promise<void> { disposed = true; await flush(); },
    get sequence() { return sequence; },
  };
}


/** Retained lanes are choices, never silently merged or deleted. Callers may
 * copy a selected checkpoint into the current lane after user-directed recovery. */
export async function readDraftCandidates(baseScopeKey: string, adapter: DraftCheckpointAdapter = createIndexedDbDraftAdapter()): Promise<DraftCheckpoint[]> {
  if (adapter.list) return adapter.list(baseScopeKey);
  const legacy = await adapter.read(baseScopeKey);
  return legacy ? [legacy] : [];
}
