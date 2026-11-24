import type { CollaborationState } from "./collaboration-provider";

export type CachedCollaborationSnapshot = CollaborationState & { state: string | Uint8Array };
const MAX_ENTRIES = 4;
const MAX_UPDATES = 100;
const MAX_UPDATE_CHARS = 4 << 20;

export function resumedSnapshot(base: CachedCollaborationSnapshot, reply: CollaborationState): CachedCollaborationSnapshot | null {
  if (reply.state || reply.document_id !== base.document_id || reply.epoch !== base.epoch || reply.content_version < base.content_version) return null;
  if (reply.content_version > base.content_version && !reply.updates?.length) return null;
  const updates = [...(base.updates ?? []), ...(reply.updates ?? [])];
  if (updates.length > MAX_UPDATES || updates.reduce((size, update) => size + update.length, 0) > MAX_UPDATE_CHARS) return null;
  return { ...reply, state: base.state, updates };
}

// This store holds server-confirmed state only. The outbox and pending local
// changes live in the separate collaboration draft store.
export function collaborationSnapshotCache(factory = globalThis.indexedDB) {
  let opening: Promise<IDBDatabase> | undefined;
  function database() {
    return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open("orbis-collaboration-snapshots", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("snapshots").createIndex("accessedAt", "accessedAt");
      open.onsuccess = () => {
        open.result.onversionchange = () => open.result.close();
        resolve(open.result);
      };
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("协作快照缓存暂不可用"));
    });
  }
  return {
    async read(key: string): Promise<CachedCollaborationSnapshot | undefined> {
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("snapshots", "readonly");
        const request = tx.objectStore("snapshots").get(key);
        tx.oncomplete = () => resolve(request.result?.snapshot);
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    },
    async write(key: string, snapshot: CachedCollaborationSnapshot) {
      const db = await database();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction("snapshots", "readwrite");
        const store = tx.objectStore("snapshots");
        const previous = store.get(key);
        previous.onsuccess = () => {
          if (previous.result?.snapshot.content_version > snapshot.content_version) return;
          store.put({ snapshot, accessedAt: Date.now() }, key);
          const entries = store.index("accessedAt").openKeyCursor(null, "prev");
          let retained = 0;
          entries.onsuccess = () => {
            const entry = entries.result;
            if (!entry) return;
            if (retained++ >= MAX_ENTRIES) store.delete(entry.primaryKey);
            entry.continue();
          };
        };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    },
    async close() {
      if (opening) (await opening).close();
    },
  };
}
