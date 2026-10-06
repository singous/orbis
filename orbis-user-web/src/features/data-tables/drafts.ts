import type { TableChanges, TableMutation } from "./model";

export type TableDraft = {
  scope: string;
  revision: number;
  changes: TableChanges;
  request: TableMutation | null;
  sequence: number;
};
const DATABASE = "orbis-data-table-drafts";
let opening: Promise<IDBDatabase> | null = null;
function database() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("浏览器无法保存表格草稿，请保持页面打开"));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("drafts", { keyPath: "scope" });
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
    request.onblocked = () => {
      opening = null;
      reject(new Error("表格草稿存储被另一个窗口占用"));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
  });
  return opening;
}
async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction("drafts", mode);
    let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("表格草稿保存中断"));
    run(tx.objectStore("drafts"), (next) => {
      value = next;
    });
  });
}
export const tableDrafts = {
  read(scope: string) {
    return transaction<TableDraft | null>("readonly", (store, done) => {
      const req = store.get(scope);
      req.onsuccess = () => done(req.result ?? null);
    });
  },
  write(draft: TableDraft) {
    return transaction<void>("readwrite", (store, done) => {
      const req = store.get(draft.scope);
      req.onsuccess = () => {
        if (!req.result || req.result.sequence <= draft.sequence)
          store.put(draft);
        done();
      };
    });
  },
  remove(scope: string, through: number) {
    return transaction<void>("readwrite", (store, done) => {
      const req = store.get(scope);
      req.onsuccess = () => {
        if (req.result && req.result.sequence <= through) store.delete(scope);
        done();
      };
    });
  },
  candidates(scope: string) {
    const lane = scope.indexOf("|lane:");
    const prefix = lane < 0 ? scope : scope.slice(0, lane);
    const table = scope.slice(scope.lastIndexOf("|table:"));
    return transaction<TableDraft[]>("readonly", (store, done) => {
      const found: TableDraft[] = [];
      const req = store.openCursor(
        IDBKeyRange.bound(prefix, prefix + "\uffff"),
      );
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          done(found);
          return;
        }
        const value = cursor.value as TableDraft;
        if (
          value.scope !== scope &&
          value.scope.endsWith(table) &&
          hasChanges(value.changes)
        )
          found.push(value);
        cursor.continue();
      };
    });
  },
};

export function combineChanges(
  previous: TableChanges,
  next: TableChanges,
): TableChanges {
  const rows = new Map(previous.upserts?.map((row) => [row.id, row]));
  const deleted = new Set(previous.deletes);
  for (const row of next.upserts ?? []) {
    deleted.delete(row.id);
    rows.set(row.id, {
      id: row.id,
      values: { ...rows.get(row.id)?.values, ...row.values },
    });
  }
  for (const id of next.deletes ?? []) {
    rows.delete(id);
    deleted.add(id);
  }
  return {
    ...(next.definition || previous.definition
      ? { definition: next.definition ?? previous.definition }
      : {}),
    upserts: [...rows.values()],
    deletes: [...deleted],
  };
}

/** Remove only acknowledged values; newer edits survive an older receipt. */
export function afterAcknowledgement(
  current: TableChanges,
  acknowledged: TableChanges,
): TableChanges {
  const sent = new Map(
    acknowledged.upserts?.map((row) => [row.id, row.values]),
  );
  const upserts = (current.upserts ?? [])
    .map((row) => ({
      id: row.id,
      values: Object.fromEntries(
        Object.entries(row.values).filter(
          ([key, value]) =>
            JSON.stringify(value) !== JSON.stringify(sent.get(row.id)?.[key]),
        ),
      ),
    }))
    .filter((row) => Object.keys(row.values).length);
  const deletes = (current.deletes ?? []).filter(
    (id) => !acknowledged.deletes?.includes(id),
  );
  const definition =
    JSON.stringify(current.definition) ===
    JSON.stringify(acknowledged.definition)
      ? undefined
      : current.definition;
  return { upserts, deletes, ...(definition ? { definition } : {}) };
}
export function hasChanges(value: TableChanges) {
  return Boolean(
    value.definition || value.upserts?.length || value.deletes?.length,
  );
}
