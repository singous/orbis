import * as Y from "yjs";
import { collaborationScope, createCollaborationPersistence, type CollaborationCheckpoint, type CollaborationPersistence, type PendingCollaborationUpdate, type CollaborationTarget } from "./collaboration-persistence";
import { validTableCopies, type TableCopyIntent } from "./table-copy";
import { COLLABORATION_ATOMIC_ATTRIBUTES, fingerprintElement } from "../../content/codecs/collaboration-fingerprint";
import { resolveDraftLane, type DraftLaneClaim, type DraftLaneOptions } from "./draft-lanes";
import { newUUID } from "../../../shared/ids";
import { ApiError } from "../../../shared/api/api-client";

export type CollaborationState = {
  document_id: string;
  epoch: string;
  content_version: number;
  protocol_version: 1;
  state?: string | null;
  state_vector?: string;
  updates?: string[];
  updated_at_ms: number;
};
export type CollaborationProviderSnapshot = {
  status: "initializing" | "connecting" | "online" | "offline" | "read_only" | "recovery" | "error" | "disposed";
  contentVersion: number;
  pendingCount: number;
  isSaved: boolean;
  readOnly: boolean;
  error: string | null;
  recoveries: CollaborationCheckpoint[];
};
type Socket = Pick<WebSocket, "readyState" | "send" | "close" | "onopen" | "onmessage" | "onerror" | "onclose">;
export type CollaborationNetwork = { online(): boolean; subscribe(listener: (online: boolean) => void): () => void };
export type CollaborationProviderOptions = {
  documentId: string;
  workspaceId: string;
  userId: string;
  initialState: CollaborationState;
  token: () => Promise<string> | string;
  refreshToken?: (signal?: AbortSignal) => Promise<string | null>;
  onForbidden?: () => void;
  onError?: (error: Error) => void;
  socketUrl?: string;
  persistence?: CollaborationPersistence;
  socketFactory?: (url: string) => Socket;
  debounceMs?: number;
  reconnectDelayMs?: number;
  readOnly?: boolean;
  laneOptions?: DraftLaneOptions;
  network?: CollaborationNetwork;
  connectionTimeoutMs?: number;
};
const REMOTE_ORIGIN = Symbol("orbis-durable-collaboration");
const UPDATE_DELAY_MS = 150, BACKPRESSURE_DELAY_MS = 750, RECONNECT_DELAY_MS = 500, MAX_RECONNECT_DELAY_MS = 15000, ACK_TIMEOUT_MS = 15000;
const MAX_PENDING_OPERATIONS = 64, MAX_PENDING_BYTES = 16 << 20;
const CONNECTION_TIMEOUT_MS = 10000;
const ATOMIC_ATTRIBUTES = new Set<string>(COLLABORATION_ATOMIC_ATTRIBUTES);
function browserNetwork(): CollaborationNetwork {
  return {
    online: () => globalThis.navigator?.onLine !== false,
    subscribe(listener) {
      const online = () => listener(true), offline = () => listener(false);
      globalThis.addEventListener("online", online); globalThis.addEventListener("offline", offline);
      return () => { globalThis.removeEventListener("online", online); globalThis.removeEventListener("offline", offline); };
    },
  };
}

export function encodeCollaborationUpdate(update: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < update.length; offset += 32768) binary += String.fromCharCode(...update.subarray(offset, offset + 32768));
  return btoa(binary);
}
export function decodeCollaborationUpdate(update: string): Uint8Array {
  return Uint8Array.from(atob(update), character => character.charCodeAt(0));
}
function socketAddress(workspace: string, document: string): string {
  const url = new URL(`/api/v1/workspaces/${encodeURIComponent(workspace)}/documents/${encodeURIComponent(document)}/collaboration/socket`, globalThis.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
function liveBlocks(doc: Y.Doc): Map<string, Y.XmlElement> {
  const result = new Map<string, Y.XmlElement>();
  const walk = (fragment: Y.XmlFragment | Y.XmlElement) => {
    for (const child of fragment.toArray()) if (child instanceof Y.XmlElement) {
      const id = child.getAttribute("orbisId");
      if (typeof id === "string") result.set(id, child);
      walk(child);
    }
  };
  walk(doc.getXmlFragment("body"));
  return result;
}
function elementsByIdentity(doc: Y.Doc): Map<string, Y.XmlElement> {
  const result = new Map<string, Y.XmlElement>();
  const walk = (fragment: Y.XmlFragment | Y.XmlElement) => {
    for (const child of fragment.toArray()) if (child instanceof Y.XmlElement) {
      if (child._item) result.set(`${child._item.id.client}:${child._item.id.clock}`, child);
      walk(child);
    }
  };
  walk(doc.getXmlFragment("body"));
  return result;
}

/** One provider owns one editor's Y.Doc, transport, retry timers and outbox.
 * Socket delivery and IndexedDB completion never count as a server save. */
export class DocumentCollaborationProvider {
  readonly doc = new Y.Doc({ gc: false });
  private readonly intentBaseline = new Y.Doc({ gc: false });
  private readonly persistence: CollaborationPersistence;
  private readonly network: CollaborationNetwork;
  private unsubscribeNetwork: (() => void) | null = null;
  private readonly scope: string;
  private readonly epoch: string;
  private lane = "";
  private laneClaim: DraftLaneClaim | null = null;
  private readonly startAbort = new AbortController();
  private sequence = 0;
  private syncedVersion: number;
  private contentVersion: number;
  private snapshot: CollaborationProviderSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly pending = new Map<string, PendingCollaborationUpdate>();
  private readonly persisted = new Set<string>();
  private readonly transmitted = new Set<string>();
  private buffered: Uint8Array[] = [];
  private bufferedTargets: CollaborationTarget[] = [];
  private stagedCopies: TableCopyIntent[] = [];
  private socket: Socket | null = null;
  private transportReady = false;
  private disposed = false;
  private started = false;
  private terminal = false;
  private startPromise: Promise<void> | null = null;
  private disposePromise: Promise<void> | null = null;
  private persistenceQueue: Promise<void> = Promise.resolve();
  private bufferTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshAbort: AbortController | null = null;
  private retryAttempt = 0;
  private inFlight: string | null = null;
  private refreshedToken: string | null = null;
  private refreshing = false;
  private authRefreshAttempted = false;
  private readonly waiters = new Set<{ ids: Set<string>; resolve: (version: number) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly options: CollaborationProviderOptions) {
    this.persistence = options.persistence ?? createCollaborationPersistence();
    this.network = options.network ?? browserNetwork();
    this.scope = collaborationScope({ origin: globalThis.location.origin, userId: options.userId, workspaceId: options.workspaceId, documentId: options.documentId });
    this.epoch = options.initialState.epoch;
    this.syncedVersion = options.initialState.content_version;
    this.contentVersion = options.initialState.content_version;
    this.snapshot = { status: "initializing", contentVersion: options.initialState.content_version, pendingCount: 0, isSaved: false, readOnly: options.readOnly ?? false, error: null, recoveries: [] };
    this.doc.on("update", this.localUpdate);
  }

  getSnapshot = (): CollaborationProviderSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  stageTableCopies(copies: TableCopyIntent[]): () => void {
    if (!validTableCopies(copies) || this.options.readOnly || this.disposed || this.terminal) throw new Error("表格复制记录无效，操作已取消。");
    // The clipboard stages intent before dispatching its content transaction.
    // Flush any earlier edits first so the intent binds only to the next delta.
    if (this.buffered.length) void this.flushBuffered().catch(() => {});
    const staged = structuredClone(copies);
    this.stagedCopies = [...this.stagedCopies, ...staged];
    return () => { this.stagedCopies = this.stagedCopies.filter(copy => !staged.includes(copy)); };
  }

  private notify(change: Partial<CollaborationProviderSnapshot> = {}) {
    const pendingCount = this.pending.size + (this.buffered.length ? 1 : 0);
    const next = { ...this.snapshot, ...change, contentVersion: this.contentVersion, pendingCount, isSaved: this.started && pendingCount === 0 && !this.terminal && !this.disposed };
    if ((Object.keys(next) as Array<keyof CollaborationProviderSnapshot>).every(key => next[key] === this.snapshot[key])) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
  private applyState(state: CollaborationState) {
    if (state.document_id !== this.options.documentId || state.protocol_version !== 1 || !Number.isSafeInteger(state.content_version) || state.content_version < 1 || typeof state.epoch !== "string") throw new Error("协作服务返回了无法识别的文档状态。");
    if (state.epoch !== this.epoch) throw new Error("文档已切换到新的协作版本，本机草稿需要恢复。");
    const updates = [...(state.state ? [state.state] : []), ...(state.updates ?? [])].map(decodeCollaborationUpdate);
    const targets = [...this.bufferedTargets, ...[...this.pending.values()].flatMap(operation => operation.targets ?? [])];
    if (targets.length) {
      const preview = new Y.Doc({ gc: false });
      try {
        Y.applyUpdate(preview, Y.encodeStateAsUpdate(this.doc));
        for (const update of updates) Y.applyUpdate(preview, update);
        const before = liveBlocks(this.doc), after = liveBlocks(preview);
        for (const target of targets) {
          const oldElement = before.get(target.block_id), nextElement = after.get(target.block_id);
          if ((target.atomic || oldElement?.nodeName === "orbisDrawing") && oldElement && nextElement && fingerprintElement(oldElement) !== fingerprintElement(nextElement)) throw new Error("另一个编辑端修改了本机正在编辑的块属性。请先下载本机草稿，再重新打开文档恢复内容。");
          const old = oldElement?._item, next = nextElement?._item;
          if ((old && (!next || old.id.client !== next.id.client || old.id.clock !== next.id.clock)) || (!old && next)) throw new Error("并发操作移动或删除了本机正在修改的内容。请先下载本机草稿，再重新打开文档恢复内容。");
        }
      } finally { preview.destroy(); }
    }
    this.contentVersion = Math.max(this.contentVersion, state.content_version);
    this.syncedVersion = Math.max(this.syncedVersion, state.content_version);
    // Node views may render synchronously during Yjs application and issue
    // version-bound reads. Publish the matching durable version first.
    this.notify();
    for (const update of updates) Y.applyUpdate(this.doc, update, REMOTE_ORIGIN);
    for (const update of updates) Y.applyUpdate(this.intentBaseline, update, REMOTE_ORIGIN);
  }
  private checkpoint(): CollaborationCheckpoint {
    return { scope: this.scope, epoch: this.epoch, lane: this.lane, updatedAtMs: Date.now(), state: Y.encodeStateAsUpdate(this.doc), contentVersion: this.contentVersion, pending: [...this.pending.values()] };
  }
  private persist(added: PendingCollaborationUpdate[] = [], acknowledged: string[] = []): Promise<void> {
    if (this.buffered.length) {
      const unsent = [...this.pending.values()].find(operation => !this.transmitted.has(operation.operation_id));
      const update = Y.mergeUpdates([...(unsent ? [decodeCollaborationUpdate(unsent.update)] : []), ...this.buffered]);
      const targets = new Map<string, CollaborationTarget>();
      for (const target of [...(unsent?.targets ?? []), ...this.bufferedTargets]) {
        const key = `${target.client}:${target.clock}`, previous = targets.get(key);
        targets.set(key, { ...previous, ...target, ...(previous?.content_hash ? { content_hash: previous.content_hash } : {}) });
      }
      const allCopies = [...(unsent?.table_copies ?? []), ...this.stagedCopies];
      const visible = allCopies.length ? liveBlocks(this.doc) : null;
      const copies = allCopies.filter(copy => visible!.has(copy.block_id));
      const operation: PendingCollaborationUpdate = { operation_id: unsent?.operation_id ?? newUUID(), sequence: unsent?.sequence ?? ++this.sequence, update: encodeCollaborationUpdate(update), targets: [...targets.values()], ...(copies.length ? { table_copies: copies } : {}) };
      this.buffered = [];
      this.bufferedTargets = [];
      this.stagedCopies = [];
      this.pending.set(operation.operation_id, operation);
      this.persisted.delete(operation.operation_id);
      added = [...added, operation];
      this.notify();
    }
    const checkpoint = this.checkpoint();
    const overBudget = this.pending.size > MAX_PENDING_OPERATIONS || [...this.pending.values()].some(operation => operation.table_copies && !validTableCopies(operation.table_copies)) || [...this.pending.values()].reduce((size, operation) => size + Math.ceil(operation.update.length * 3 / 4), 0) > MAX_PENDING_BYTES;
    if (overBudget) this.stop("recovery", "待保存的本机修改已达到离线缓存上限。内容仍已保留，请下载草稿并恢复连接后重新打开文档。");
    const write = this.persistenceQueue.then(() => this.persistence.write(checkpoint, added, acknowledged)).then(() => { for (const operation of added) if (this.pending.get(operation.operation_id) === operation) this.persisted.add(operation.operation_id); this.sendNext(); });
    this.persistenceQueue = write.catch(error => { this.stop("error", error instanceof Error ? error : "本地协作草稿保存失败。"); });
    return write;
  }
  private localUpdate = (update: Uint8Array, origin: unknown, _doc: Y.Doc, transaction: Y.Transaction) => {
    if (origin === REMOTE_ORIGIN || !transaction.local || this.disposed || this.options.readOnly) return;
    const targets = new Map<string, CollaborationTarget>();
    let originalElements: Map<string, Y.XmlElement> | undefined;
    const fingerprints = new Map<string, string>();
    const target = (type: Y.AbstractType<any> | null, structural = false, atomic = false) => {
      while (type) {
        if (type instanceof Y.XmlElement && type._item) {
          const id = type.getAttribute("orbisId") ?? type._map.get("orbisId")?.content.getContent()[0];
          const atomicOwner = typeof id === "string" && atomic;
          if (typeof id === "string") atomic = false;
          if (typeof id === "string" && type._item.id.clock < (transaction.beforeState.get(type._item.id.client) ?? 0)) {
            const key = `${type._item.id.client}:${type._item.id.clock}`;
            let contentHash: string | undefined;
            if (structural || atomicOwner) {
              originalElements ??= elementsByIdentity(this.intentBaseline);
              const original = originalElements.get(key);
              if (original) {
                contentHash = fingerprints.get(key) ?? fingerprintElement(original);
                fingerprints.set(key, contentHash);
              }
            }
            targets.set(key, { ...targets.get(key), block_id: id, ...type._item.id, deleted: type._item.deleted, ...(contentHash ? { content_hash: contentHash } : {}), ...(atomicOwner ? { atomic: true } : {}) });
          }
        }
        type = type.parent;
      }
    };
    const removedTarget = (element: Y.XmlElement) => {
      const id = element.getAttribute("orbisId") ?? element._map.get("orbisId")?.content.getContent()[0];
      if (typeof id === "string" && element._item) {
        originalElements ??= elementsByIdentity(this.intentBaseline);
        if (originalElements.has(`${element._item.id.client}:${element._item.id.clock}`)) { target(element, true); return; }
      }
      // Deleted list wrappers no longer expose their children through toArray.
      // Retained tombstones identify the topmost owned blocks needing proofs.
      for (let item = element._start; item; item = item.right) for (const content of item.content.getContent()) if (content instanceof Y.XmlElement) removedTarget(content);
    };
    for (const [type, events] of transaction.changedParentTypes) {
      const atomic = type instanceof Y.XmlElement && [...(transaction.changed.get(type as any) ?? [])].some(name => typeof name === "string" && ATOMIC_ATTRIBUTES.has(name));
      target(type, false, atomic);
      for (const event of events) for (const item of event.changes.deleted) for (const content of item.content.getContent()) if (content instanceof Y.XmlElement) removedTarget(content);
    }
    this.bufferedTargets.push(...targets.values());
    this.buffered.push(update);
    this.notify();
    if (this.bufferTimer === null) this.bufferTimer = setTimeout(() => { this.bufferTimer = null; void this.flushBuffered().catch(() => {}); }, this.options.debounceMs ?? (this.inFlight || !this.transportReady ? BACKPRESSURE_DELAY_MS : UPDATE_DELAY_MS));
  };
  private async flushBuffered(): Promise<void> {
    if (this.bufferTimer !== null) { clearTimeout(this.bufferTimer); this.bufferTimer = null; }
    if (!this.buffered.length) { await this.persistenceQueue; return; }
    await this.persist();
    this.sendNext();
  }

  start(): Promise<void> {
    return this.startPromise ??= this.initialize();
  }
  private async initialize() {
    try {
      this.laneClaim = await resolveDraftLane("collaboration:" + this.scope, { ...this.options.laneOptions, signal: this.startAbort.signal });
      this.lane = this.laneClaim.laneId;
      if (this.disposed) { this.laneClaim.release(); return; }
      const checkpoints = await this.persistence.read(this.scope);
      if (this.disposed) return;
      this.notify({ recoveries: checkpoints.filter(checkpoint => checkpoint.pending.length > 0) });
      const local = this.options.readOnly || this.laneClaim.ownership !== "confirmed" ? [] : checkpoints.filter(checkpoint => checkpoint.epoch === this.epoch && checkpoint.lane === this.lane && checkpoint.pending.length > 0);
      for (const [index, checkpoint] of local.entries()) {
        if (index === 0) Y.applyUpdate(this.doc, checkpoint.state, REMOTE_ORIGIN);
        else {
          try { this.applyState({ ...this.options.initialState, state: encodeCollaborationUpdate(checkpoint.state) }); }
          catch (error) { this.stop("recovery", error instanceof Error ? error : "多个本机草稿需要人工恢复。"); throw error; }
        }
        for (const operation of checkpoint.pending) { this.pending.set(operation.operation_id, operation); this.persisted.add(operation.operation_id); this.transmitted.add(operation.operation_id); }
      }
      const ordered = [...this.pending.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      this.pending.clear();
      for (const operation of ordered) this.pending.set(operation.operation_id, operation);
      this.sequence = Math.max(0, ...[...this.pending.values()].map(operation => operation.sequence ?? 0));
      try { this.applyState(this.options.initialState); }
      catch (error) {
        this.stop("recovery", error instanceof Error ? error : "本机草稿与当前文档需要人工恢复。");
        throw error;
      }
      for (const operation of this.pending.values()) Y.applyUpdate(this.intentBaseline, decodeCollaborationUpdate(operation.update), REMOTE_ORIGIN);
      this.started = true;
      this.notify({ recoveries: checkpoints.filter(checkpoint => (checkpoint.epoch !== this.epoch || this.options.readOnly || !local.includes(checkpoint)) && checkpoint.pending.length > 0) });
      await this.persist();
      if (!this.disposed) { this.unsubscribeNetwork = this.network.subscribe(this.networkChanged); this.networkChanged(this.network.online()); }
    } catch (error) {
      if (!this.terminal) this.stop("error", error instanceof Error ? error : "协作草稿恢复失败。");
      throw error;
    }
  }
  async synchronize(state: CollaborationState): Promise<void> {
    try {
      this.applyState(state);
      await this.persist();
      this.notify();
    } catch (error) {
      this.stop("recovery", error instanceof Error ? error : "无法同步文档，本机草稿仍已保留。");
      throw error;
    }
  }
  private networkChanged = (online: boolean) => {
    if (this.disposed || this.terminal) return;
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (!online) {
      this.refreshAbort?.abort();
      this.disconnect();
      this.notifyOffline();
      void this.flushBuffered().catch(() => {});
    } else {
      this.retryAttempt = 0;
      this.connect();
    }
  };
  private notifyOffline(error?: string) {
    this.notify({ status: "offline", error: error ?? (this.pending.size || this.buffered.length ? "网络已断开，修改保留在本机，恢复连接后继续保存。" : null) });
  }
  private connect() {
    if (this.disposed || this.terminal || this.socket || this.refreshing) return;
    if (!this.network.online()) { this.notifyOffline(); return; }
    this.notify({ status: "connecting", error: null });
    let socket: Socket;
    try { socket = (this.options.socketFactory ?? (url => new WebSocket(url)))(this.options.socketUrl ?? socketAddress(this.options.workspaceId, this.options.documentId)); }
    catch { this.scheduleReconnect(); return; }
    this.socket = socket;
    this.connectionTimer = setTimeout(() => {
      this.connectionTimer = null;
      if (this.socket !== socket || this.disposed || this.terminal) return;
      this.disconnect();
      this.scheduleReconnect();
    }, this.options.connectionTimeoutMs ?? CONNECTION_TIMEOUT_MS);
    socket.onopen = () => {
      void Promise.resolve(this.refreshedToken ?? this.options.token()).then(token => {
        if (this.socket !== socket || this.disposed || this.terminal) return;
        socket.send(JSON.stringify({ type: "authenticate", token, protocol_version: 1, after_version: this.syncedVersion }));
      }).catch(() => this.stop("read_only", "登录状态已失效，本机修改仍已保留。"));
    };
    socket.onmessage = event => {
      if (this.socket !== socket || this.disposed || this.terminal) return;
      try { this.receive(JSON.parse(String(event.data)) as Record<string, unknown>); }
      catch (error) { this.stop("error", error instanceof Error ? error : "无法读取协作消息，本机修改仍已保留。"); }
    };
    socket.onerror = () => { if (this.socket === socket) socket.close(); };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.transportReady = false;
      this.inFlight = null;
      this.clearAckTimer();
      this.clearConnectionTimer();
      if (!this.disposed && !this.terminal) this.scheduleReconnect();
    };
  }
  private receive(message: Record<string, unknown>) {
    if (message.type === "ready") {
      if (message.protocol_version !== undefined && message.protocol_version !== 1) throw new Error("协作协议版本不受支持。");
      this.transportReady = true;
      this.clearConnectionTimer();
      this.authRefreshAttempted = false;
      this.retryAttempt = 0;
      this.notify({ status: "online", error: null });
      this.sendNext();
    } else if (message.type === "state") {
      const state = message.data as CollaborationState;
      if (state?.epoch !== this.epoch) { this.stop("recovery", "文档已切换到新的协作版本。请下载本机草稿，再重新打开文档。"); return; }
      try { this.applyState(state); }
      catch (error) { this.stop("recovery", error instanceof Error ? error : "并发操作改变了本机编辑目标，请下载草稿后恢复。"); return; }
      this.transportReady = true;
      this.clearConnectionTimer();
      this.authRefreshAttempted = false;
      this.retryAttempt = 0;
      this.notify({ status: "online", error: null });
      void this.persist().then(() => this.sendNext()).catch(() => {});
    } else if (message.type === "ack") {
      if (message.epoch !== this.epoch) { this.stop("recovery", "保存回执属于其他协作版本，本机草稿仍已保留。"); return; }
      if (typeof message.operation_id !== "string" || !Number.isSafeInteger(message.content_version) || Number(message.content_version) < 1) throw new Error("协作保存回执格式不正确。");
      const id = message.operation_id;
      if (!this.pending.has(id)) return;
      this.pending.delete(id);
      this.persisted.delete(id);
      this.transmitted.delete(id);
      this.contentVersion = Math.max(this.contentVersion, Number(message.content_version));
      if (this.inFlight === id) { this.inFlight = null; this.clearAckTimer(); }
      this.notify();
      void this.persist([], [id]).then(() => {
        this.notify();
        this.settleWaiters();
        this.sendNext();
      }).catch(() => {});
    } else if (message.type === "error") {
      const status = Number(message.status), code = String(message.code ?? "");
      const detail = typeof message.message === "string" ? message.message : "协作保存失败，本机草稿仍已保留。";
      if (status === 401) { void this.refreshAuthentication(); return; }
      if (status === 403 || status === 404) { this.stop("read_only", detail); this.options.onForbidden?.(); return; }
      if (status === 409 || code === "COLLABORATION_TARGET_REMOVED") { this.stop("recovery", detail); return; }
      if (status >= 400 && status < 500) { this.stop("error", detail); return; }
      this.socket?.close();
    } else throw new Error("协作服务发送了不支持的消息类型。");
  }
  private sendNext() {
    if (!this.transportReady || this.options.readOnly || this.terminal || this.disposed || this.inFlight || this.socket?.readyState !== 1) return;
    const operation = this.pending.values().next().value as PendingCollaborationUpdate | undefined;
    if (!operation || !this.persisted.has(operation.operation_id)) return;
    this.inFlight = operation.operation_id;
    if (!this.transmitted.has(operation.operation_id)) {
      this.transmitted.add(operation.operation_id);
      Y.applyUpdate(this.intentBaseline, decodeCollaborationUpdate(operation.update), REMOTE_ORIGIN);
    }
    try {
      const { targets, sequence: _sequence, ...wire } = operation;
      this.socket.send(JSON.stringify({ type: "update", epoch: this.epoch, ...wire, ...(targets?.length ? { targets: targets.map(({ client, clock, content_hash }) => ({ client, clock, ...(content_hash ? { content_hash } : {}) })) } : {}) }));
      this.ackTimer = setTimeout(() => { this.ackTimer = null; this.socket?.close(); }, ACK_TIMEOUT_MS);
    } catch { this.socket.close(); }
  }
  private scheduleReconnect() {
    if (this.reconnectTimer !== null || this.disposed || this.terminal || this.refreshing) return;
    this.notifyOffline();
    if (!this.network.online()) return;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, (this.options.reconnectDelayMs ?? RECONNECT_DELAY_MS) * 2 ** Math.min(this.retryAttempt++, 8));
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
  }
  private async refreshAuthentication() {
    if (this.refreshing) return;
    if (this.authRefreshAttempted) { this.stop("read_only", "登录状态无法验证，请重新登录。本机草稿仍已保留。"); return; }
    this.authRefreshAttempted = true;
    this.refreshing = true;
    this.disconnect();
    const abort = new AbortController();
    this.refreshAbort = abort;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancel: (() => void) | undefined;
    try {
      const cancelled = new Promise<never>((_resolve, reject) => {
        cancel = () => reject(new DOMException("Authentication refresh interrupted", "AbortError"));
        abort.signal.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(() => abort.abort(), this.options.connectionTimeoutMs ?? CONNECTION_TIMEOUT_MS);
      });
      const token = await Promise.race([this.options.refreshToken?.(abort.signal) ?? Promise.resolve(null), cancelled]);
      if (this.disposed) return;
      if (!token) { this.stop("read_only", "登录状态已失效，请重新登录。本机草稿仍已保留。"); return; }
      this.refreshedToken = token;
      this.refreshing = false;
      this.connect();
    } catch (error) {
      if (this.disposed) return;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) this.stop("read_only", "登录状态无法验证，请重新登录。本机草稿仍已保留。");
      else if (error instanceof ApiError && error.status < 500 && ![408, 429].includes(error.status)) this.stop("error", error);
      else {
        this.authRefreshAttempted = false;
        this.refreshing = false;
        this.scheduleReconnect();
      }
    }
    finally { if (timer !== null) clearTimeout(timer); if (cancel) abort.signal.removeEventListener("abort", cancel); if (this.refreshAbort === abort) this.refreshAbort = null; this.refreshing = false; }
  }
  private clearAckTimer() { if (this.ackTimer !== null) { clearTimeout(this.ackTimer); this.ackTimer = null; } }
  private clearConnectionTimer() { if (this.connectionTimer !== null) { clearTimeout(this.connectionTimer); this.connectionTimer = null; } }
  private disconnect() {
    this.clearAckTimer();
    this.clearConnectionTimer();
    this.transportReady = false;
    this.inFlight = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) { socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null; socket.close(); }
  }
  private stop(status: "read_only" | "recovery" | "error", reason: string | Error) {
    if (this.disposed) return;
    const failure = reason instanceof Error ? reason : new Error(reason);
    const error = failure.message;
    const changed = !this.terminal || this.snapshot.error !== error;
    this.terminal = true;
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.disconnect();
    this.notify({ status, readOnly: true, error });
    if (changed) this.options.onError?.(failure);
    this.settleWaiters(failure);
  }
  private settleWaiters(error?: Error) {
    for (const waiter of this.waiters) {
      if (!error && [...waiter.ids].some(id => this.pending.has(id))) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      if (error) waiter.reject(error); else waiter.resolve(this.contentVersion);
    }
  }
  async flush(options: { timeoutMs?: number } = {}): Promise<number> {
    await this.start();
    await this.flushBuffered();
    if (this.terminal || this.disposed) throw new Error(this.snapshot.error ?? "协作编辑会话已关闭。");
    if (!this.pending.size) return this.contentVersion;
    return new Promise((resolve, reject) => {
      const waiter = { ids: new Set(this.pending.keys()), resolve, reject, timer: setTimeout(() => { this.waiters.delete(waiter); reject(new Error("保存确认尚未收到，修改仍保留在本机，请恢复连接后重试。")); }, options.timeoutMs ?? ACK_TIMEOUT_MS) };
      this.waiters.add(waiter);
      this.sendNext();
    });
  }
  exportRecovery(): string {
    return JSON.stringify({ format: "orbis-collaboration-recovery-v1", document_id: this.options.documentId, epoch: this.epoch, content_version: this.contentVersion, state: encodeCollaborationUpdate(Y.encodeStateAsUpdate(this.doc)), pending: [...this.pending.values()], previous_epochs: this.snapshot.recoveries.map(checkpoint => ({ epoch: checkpoint.epoch, state: encodeCollaborationUpdate(checkpoint.state), pending: checkpoint.pending })) });
  }
  async saveRecovery(): Promise<void> {
    if (this.disposed) throw new Error("协作编辑会话已关闭。");
    await this.flushBuffered();
    await this.persist([...this.pending.values()]);
  }
  dispose(): Promise<void> { return this.disposePromise ??= this.disposeOwned(); }
  private async disposeOwned(): Promise<void> {
    this.disposed = true;
    this.unsubscribeNetwork?.(); this.unsubscribeNetwork = null;
    this.refreshAbort?.abort();
    if (!this.laneClaim) this.startAbort.abort();
    this.doc.off("update", this.localUpdate);
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.disconnect();
    this.settleWaiters(new Error("协作编辑会话已关闭，本机草稿仍已保留。"));
    try { await this.flushBuffered(); await this.persistenceQueue; }
    finally {
      try { await this.persistence.close(); }
      finally {
        this.laneClaim?.release();
        try { await this.laneClaim?.released; }
        finally {
          this.startAbort.abort();
          this.doc.destroy(); this.intentBaseline.destroy();
          this.notify({ status: "disposed", readOnly: true }); this.listeners.clear();
        }
      }
    }
  }
}
