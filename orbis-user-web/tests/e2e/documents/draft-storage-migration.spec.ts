import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

let adapterBundle: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL("../../../src/features/documents/draft-checkpoints.ts", import.meta.url))], bundle: true, write: false, format: "iife", globalName: "DraftStorageTest", platform: "browser", target: "es2022" });
  adapterBundle = result.outputFiles[0].text;
});

test("a version-one draft upgrades intact and sequence guards never read full checkpoint values", async ({ page }) => {
  await page.goto("/login");
  const original = await page.evaluate(async () => {
    const blocks = { schema_version: 2, editor: "blocknote", blocks: [{ id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "preserve migration body" }], children: [] }] };
    const value = { scopeKey: "legacy", sequence: 9, saved: { title: "Title", version: 2, blocks }, current: { title: "Unsaved", version: 2, blocks }, window: { noteId: "note", version: 2, next: 32, total: 10000, hasMore: true, bounded: true }, descriptors: [["p", { id: "p", parent_id: null, child_count: 10000, has_children: true, children_loaded: false, payload_loaded: false, payload_bytes: 300000, offset: 32 }]] };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("orbis-document-drafts", 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("checkpoints", { keyPath: "scopeKey" });
      opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
    });
    await new Promise<void>((resolve, reject) => { const tx = database.transaction("checkpoints", "readwrite"); tx.objectStore("checkpoints").put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    database.close(); return value;
  });
  await page.addScriptTag({ content: adapterBundle });
  const result = await page.evaluate(async () => {
    const module = (window as unknown as { DraftStorageTest: typeof import("../../../src/features/documents/draft-checkpoints") }).DraftStorageTest;
    const adapter = module.createIndexedDbDraftAdapter();
    const migrated = await adapter.read("legacy");
    const oldGet = IDBObjectStore.prototype.get;
    let valueReads = 0;
    IDBObjectStore.prototype.get = function (query) { if (this.name === "checkpoints") valueReads += 1; return oldGet.call(this, query); };
    try {
      await adapter.put({ ...migrated!, sequence: 8 });
      await adapter.remove("legacy", 8);
      const guardReads = valueReads;
      const retained = await adapter.read("legacy");
      await adapter.put({ ...migrated!, sequence: 10, current: { ...migrated!.current, title: "newer unsaved" } });
      await adapter.remove("legacy", 9);
      const newer = await adapter.read("legacy");
      await adapter.remove("legacy", 10);
      const cleared = await adapter.read("legacy");
      const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("orbis-document-drafts"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const schema = { version: database.version, index: database.transaction("checkpoints").objectStore("checkpoints").indexNames.contains("scope-sequence") };
      database.close(); return { migrated, retained, newer, cleared, guardReads, schema };
    } finally { IDBObjectStore.prototype.get = oldGet; }
  });
  expect(result.migrated).toEqual(original);
  expect(result.retained).toEqual(original);
  expect(result.newer).toMatchObject({ sequence: 10, current: { title: "newer unsaved" } });
  expect(result.cleared).toBeNull();
  expect(result.guardReads).toBe(0);
  expect(result.schema).toEqual({ version: 2, index: true });
});

test("concurrent native connections preserve newer writes and close on versionchange", async ({ page }) => {
  await page.goto("/login"); await page.addScriptTag({ content: adapterBundle });
  const result = await page.evaluate(async () => {
    const module = (window as unknown as { DraftStorageTest: typeof import("../../../src/features/documents/draft-checkpoints") }).DraftStorageTest;
    const first = module.createIndexedDbDraftAdapter(), second = module.createIndexedDbDraftAdapter();
    const blocks = { schema_version: 2 as const, editor: "blocknote", blocks: [] };
    const draft = { title: "current", version: 2, blocks };
    const value = { scopeKey: "shared", sequence: 1, saved: draft, current: draft, window: null, descriptors: [] };
    await first.put(value);
    await second.read("shared");
    await Promise.all([first.put({ ...value, sequence: 3 }), second.remove("shared", 2)]);
    const retained = await second.read("shared");
    await first.put({ ...value, scopeKey: "other-lane", sequence: 1 });
    await first.remove("shared", 3);
    const other = await second.read("other-lane");
    const next = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("orbis-document-drafts", 3);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Existing draft connections did not close"));
    });
    const upgraded = next.version; next.close(); return { retained, other, upgraded };
  });
  expect(result.retained?.sequence).toBe(3);
  expect(result.other?.scopeKey).toBe("other-lane");
  expect(result.upgraded).toBe(3);
});
