import type { BoardPage, Element, Mutation } from "./model";
export type PendingOperation = {
  input: Mutation;
  before: Element[];
  before_pages: BoardPage[];
  page_id: string;
  history_mode: "normal" | "undo" | "redo";
};
const DATABASE = "orbis-board-drafts",
  STORE = "pending",
  MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("无法打开本机画板草稿，请检查浏览器存储权限。"));
  });
}
export async function readJournal(key: string): Promise<PendingOperation[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly"),
        request = transaction.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function writeJournal(
  key: string,
  queue: PendingOperation[],
  expected: PendingOperation[],
): Promise<void> {
  if (
    new TextEncoder().encode(JSON.stringify(queue)).byteLength >
    MAX_JOURNAL_BYTES
  )
    throw new Error("本机未同步修改已达到上限，请先恢复同步或导出草稿。");
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite"),
        store = transaction.objectStore(STORE);
      const current = store.get(key);
      current.onsuccess = () => {
        const saved: PendingOperation[] = current.result ?? [];
        if (
          saved.length !== expected.length ||
          saved.some(
            (entry, index) =>
              entry.input.operation_id !== expected[index].input.operation_id,
          )
        ) {
          reject(
            new Error(
              "另一个窗口已修改这张画板的本机草稿，请重新打开画板后继续；当前草稿已保留。",
            ),
          );
          transaction.abort();
          return;
        }
        if (queue.length) store.put(queue, key);
        else store.delete(key);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(new Error("本机草稿保存失败，本次操作尚未提交。"));
      transaction.onabort = () =>
        reject(new Error("本机草稿保存中断，请重试。"));
    });
  } finally {
    db.close();
  }
}
