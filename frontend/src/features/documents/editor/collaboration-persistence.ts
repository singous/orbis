import * as Y from "yjs";
import type { TableCopyIntent } from "./table-copy";

export type CollaborationTarget = { block_id: string; client: number; clock: number; deleted: boolean; content_hash?: string; atomic?: boolean };
export type PendingCollaborationUpdate = { operation_id: string; update: string; sequence?: number; table_copies?: TableCopyIntent[]; targets?: CollaborationTarget[] };
export type CollaborationCheckpoint = { scope: string; epoch: string; lane?: string; updatedAtMs?: number; state: Uint8Array; contentVersion: number; pending: PendingCollaborationUpdate[] };
export interface CollaborationPersistence {
  read(scope: string): Promise<CollaborationCheckpoint[]>;
  write(checkpoint: CollaborationCheckpoint, added: PendingCollaborationUpdate[], acknowledged: string[]): Promise<void>;
  close(): Promise<void>;
}

export function collaborationScope(scope: { origin: string; userId: string; workspaceId: string; documentId: string }): string {
  return [scope.origin, scope.userId, scope.workspaceId, scope.documentId].map(value => `${value.length}:${value}`).join("|");
}

/** The binary document and its operation IDs share a transaction. Keeping the
 * outbox in separate records prevents concurrent browser tabs from overwriting
 * each other's pending work. Epoch records are retained for explicit recovery. */
export function createCollaborationPersistence(factory: IDBFactory | undefined = globalThis.indexedDB): CollaborationPersistence {
  let opening: Promise<IDBDatabase> | undefined;
  async function database(): Promise<IDBDatabase> {
    if (!factory) throw new Error("浏览器不支持本地协作草稿存储。");
    return opening ??= new Promise((resolve, reject) => {
      const request = factory.open("orbis-collaboration", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("documents", { keyPath: ["scope", "epoch", "lane"] }).createIndex("scope", "scope");
        request.result.createObjectStore("operations", { keyPath: ["scope", "epoch", "operation_id"] }).createIndex("scope", "scope");
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = undefined; };
        resolve(db);
      };
      request.onerror = () => { opening = undefined; reject(request.error ?? new Error("无法打开协作草稿存储。")); };
      request.onblocked = () => { opening = undefined; reject(new Error("协作草稿存储被旧页面占用，请关闭旧页面后重试。")); };
    });
  }
  return {
    async read(scope) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(["documents", "operations"], "readonly");
        const documents = tx.objectStore("documents").index("scope").getAll(scope);
        const operations = tx.objectStore("operations").index("scope").getAll(scope);
        tx.oncomplete = () => resolve(documents.result.map((document: Omit<CollaborationCheckpoint, "pending">) => ({ ...document, state: new Uint8Array(document.state), pending: operations.result.filter(operation => operation.epoch === document.epoch && operation.lane === document.lane).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)).map(({ operation_id, update, sequence, table_copies, targets }) => ({ operation_id, update, sequence, ...(table_copies ? { table_copies } : {}), ...(targets ? { targets } : {}) })) })));
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("无法读取协作草稿。"));
      });
    },
    async write(checkpoint, added, acknowledged) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(["documents", "operations"], "readwrite");
        const documents = tx.objectStore("documents");
        const lane = checkpoint.lane ?? "shared";
        const previous = documents.get([checkpoint.scope, checkpoint.epoch, lane]);
        previous.onsuccess = () => {
          const stored = previous.result as Omit<CollaborationCheckpoint, "pending"> | undefined;
          try {
            documents.put({ scope: checkpoint.scope, epoch: checkpoint.epoch, lane, updatedAtMs: checkpoint.updatedAtMs ?? Date.now(), state: stored ? Y.mergeUpdates([new Uint8Array(stored.state), checkpoint.state]) : checkpoint.state, contentVersion: Math.max(stored?.contentVersion ?? 0, checkpoint.contentVersion) });
            const operations = tx.objectStore("operations");
            for (const operation of added) operations.put({ scope: checkpoint.scope, epoch: checkpoint.epoch, lane, ...operation });
            for (const id of acknowledged) operations.delete([checkpoint.scope, checkpoint.epoch, id]);
            const remaining = operations.index("scope").getAll(checkpoint.scope);
            remaining.onsuccess = () => {
              const keys = documents.index("scope").getAllKeys(checkpoint.scope);
              keys.onsuccess = () => {
                for (const key of keys.result) {
                  const [, epoch, storedLane] = key as string[];
                  if (!remaining.result.some(operation => operation.epoch === epoch && operation.lane === storedLane)) documents.delete(key);
                }
              };
            };
          } catch { tx.abort(); }
        };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("本地协作草稿写入失败，当前内容仍保留在页面中。"));
      });
    },
    async close() { if (opening) { const db = await opening; db.close(); opening = undefined; } },
  };
}
