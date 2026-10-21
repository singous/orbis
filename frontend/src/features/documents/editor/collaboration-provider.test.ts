import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import * as Y from "yjs";
import { DocumentCollaborationProvider, decodeCollaborationUpdate, encodeCollaborationUpdate, type CollaborationState, type CollaborationProviderOptions, type CollaborationNetwork } from "./collaboration-provider";
import { ApiError } from "../../../shared/api/api-client";
import { collaborationScope, createCollaborationPersistence } from "./collaboration-persistence";
import { fingerprintElement } from "../../content/codecs/collaboration-fingerprint";
import type { DraftLaneOptions } from "./draft-lanes";

const documentId = "00000000-0000-4000-8000-000000000001", workspaceId = "00000000-0000-4000-8000-000000000002", userId = "user", epoch = "00000000-0000-4000-8000-000000000003";
type Wire = Record<string, any>;
class FakeSocket {
  readyState = 0;
  onopen: WebSocket["onopen"] = null;
  onmessage: WebSocket["onmessage"] = null;
  onerror: WebSocket["onerror"] = null;
  onclose: WebSocket["onclose"] = null;
  constructor(readonly server: FakeServer) { queueMicrotask(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.call(this as unknown as WebSocket, new Event("open")); } }); }
  send(data: string) { if (this.readyState !== 1) throw new Error("closed"); this.server.receive(this, JSON.parse(data)); }
  message(message: Wire) { if (this.readyState === 1) this.onmessage?.call(this as unknown as WebSocket, new MessageEvent("message", { data: JSON.stringify(message) })); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.call(this as unknown as WebSocket, new CloseEvent("close")); }
}
class FakeServer {
  readonly doc = new Y.Doc({ gc: false });
  version = 1;
  readonly sockets: FakeSocket[] = [];
  readonly messages: Wire[] = [];
  readonly receipts = new Map<string, number>();
  readonly receivedUpdates = new Map<string, string>();
  acknowledge = true;
  readyOnly = false;
  rejectUpdates = false;
  blackholeAuthentication = false;
  requiredToken: string | null = null;
  constructor(seed = "server") { this.doc.getText("text").insert(0, seed); }
  state(): CollaborationState { return { document_id: documentId, epoch, content_version: this.version, protocol_version: 1, state: encodeCollaborationUpdate(Y.encodeStateAsUpdate(this.doc)), updated_at_ms: 1 }; }
  connect = () => { const socket = new FakeSocket(this); this.sockets.push(socket); return socket; };
  receive(socket: FakeSocket, message: Wire) {
    this.messages.push(message);
    if (message.type === "authenticate") {
      if (this.requiredToken && message.token !== this.requiredToken) { queueMicrotask(() => socket.message({ type: "error", status: 401 })); return; }
      if (!this.blackholeAuthentication) queueMicrotask(() => socket.message(this.readyOnly ? { type: "ready", protocol_version: 1 } : { type: "state", data: this.state() }));
      return;
    }
    if (message.type !== "update") return;
    if (this.rejectUpdates) { queueMicrotask(() => socket.message({ type: "error", status: 422, code: "COLLABORATION_UPDATE_INVALID", message: "本机修改需要恢复" })); return; }
    if (this.receivedUpdates.has(message.operation_id) && this.receivedUpdates.get(message.operation_id) !== message.update) { queueMicrotask(() => socket.message({ type: "error", status: 409, code: "IDEMPOTENCY_CONFLICT", message: "操作 ID 对应的内容已变化" })); return; }
    this.receivedUpdates.set(message.operation_id, message.update);
    if (!this.receipts.has(message.operation_id)) {
      Y.applyUpdate(this.doc, decodeCollaborationUpdate(message.update));
      this.receipts.set(message.operation_id, ++this.version);
    }
    if (this.acknowledge) queueMicrotask(() => socket.message({ type: "ack", epoch, operation_id: message.operation_id, content_version: this.receipts.get(message.operation_id) }));
  }
  updates() { return this.messages.filter(message => message.type === "update"); }
}
const providers: DocumentCollaborationProvider[] = [];
class FakeNetwork implements CollaborationNetwork {
  readonly listeners = new Set<(online: boolean) => void>();
  constructor(private current = true) {}
  online = () => this.current;
  subscribe = (listener: (online: boolean) => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  set(online: boolean) { this.current = online; for (const listener of this.listeners) listener(online); }
}
const laneFixtures = new WeakMap<IDBFactory, DraftLaneOptions>();
function laneOptions(factory: IDBFactory): DraftLaneOptions {
  let options = laneFixtures.get(factory);
  if (!options) {
    const storage = new Map<string, string>(), held = new Set<string>();
    options = {
      storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } },
      locks: { request: async (name: string, _options: unknown, action: (lock: object | null) => Promise<void>) => { if (held.has(name)) return action(null); held.add(name); try { await action({ name }); } finally { held.delete(name); } } } as unknown as Pick<LockManager, "request">,
      createChannel: null,
      settleMs: 0,
    };
    laneFixtures.set(factory, options);
  }
  return options;
}
afterEach(async () => { await Promise.all(providers.splice(0).map(provider => provider.dispose())); });
async function setup(options: Partial<CollaborationProviderOptions> = {}, server = new FakeServer(), factory = new IDBFactory(), status = "online") {
  const provider = new DocumentCollaborationProvider({ documentId, workspaceId, userId, initialState: server.state(), token: () => "token", persistence: createCollaborationPersistence(factory), socketFactory: server.connect, debounceMs: 100000, reconnectDelayMs: 1, laneOptions: laneOptions(factory), ...options });
  providers.push(provider);
  await provider.start();
  await vi.waitFor(() => expect(provider.getSnapshot().status).toBe(status));
  return { provider, server, factory };
}

describe("durable collaboration provider", () => {
  it("queues only local edits and marks saved only after a durable ACK", async () => {
    const { provider, server } = await setup();
    server.acknowledge = false;
    provider.doc.getText("text").insert(6, " local");
    expect(provider.getSnapshot().isSaved).toBe(false);
    const saving = provider.flush();
    await vi.waitFor(() => expect(server.updates()).toHaveLength(1));
    expect(provider.getSnapshot().isSaved).toBe(false);
    server.sockets[0].message({ type: "ack", operation_id: server.updates()[0].operation_id, epoch, content_version: 2 });
    await expect(saving).resolves.toBe(2);
    expect(provider.getSnapshot().isSaved).toBe(true);
    expect(server.doc.getText("text").toString()).toBe("server local");
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(server.doc));
    let delta: Uint8Array | undefined;
    remote.on("update", update => { delta = update; });
    remote.getText("text").insert(0, "remote ");
    server.sockets[0].message({ type: "state", data: { ...server.state(), state: undefined, updates: [encodeCollaborationUpdate(delta!)], content_version: 3 } });
    await vi.waitFor(() => expect(provider.doc.getText("text").toString()).toBe("remote server local"));
    expect(server.updates()).toHaveLength(1);
    expect(provider.getSnapshot().pendingCount).toBe(0);
    remote.destroy();
  });

  it("keeps subscription snapshots stable between the first dirty edit and its ACK", async () => {
    const { provider } = await setup();
    const saved = provider.getSnapshot(), listener = vi.fn();
    provider.subscribe(listener);
    provider.doc.getText("text").insert(0, "a");
    const dirty = provider.getSnapshot();
    provider.doc.getText("text").insert(1, "b");
    expect(provider.getSnapshot()).toBe(dirty);
    expect(listener).toHaveBeenCalledTimes(1);
    await provider.flush();
    expect(provider.getSnapshot()).toMatchObject({ isSaved: true, contentVersion: 2 });
    expect(saved).toMatchObject({ isSaved: true, contentVersion: 1 });
  });

  it("applies duplicate and reordered remote deltas without echo or version regression", async () => {
    const { provider, server } = await setup();
    const deltas: string[] = [];
    server.doc.on("update", update => deltas.push(encodeCollaborationUpdate(update)));
    server.doc.getText("text").insert(0, "a");
    server.doc.getText("text").insert(1, "b");
    for (const [version, update] of [[3, deltas[1]], [2, deltas[0]], [3, deltas[1]]] as const) server.sockets[0].message({ type: "state", data: { ...server.state(), state: undefined, content_version: version, updates: [update] } });
    expect(provider.doc.getText("text").toString()).toBe("abserver");
    expect(provider.getSnapshot().contentVersion).toBe(3);
    expect(server.updates()).toHaveLength(0);
  });

  it("publishes the matching version before synchronous node views observe new native content", async () => {
    const { provider, server } = await setup();
    const seen: number[] = [];
    provider.doc.on("update", () => seen.push(provider.getSnapshot().contentVersion));
    server.doc.getText("text").insert(0, "native "); server.version++;
    await provider.synchronize(server.state());
    expect(seen).toEqual([2]);
    expect(provider.getSnapshot().contentVersion).toBe(2);
  });

  it("retries a committed update with its original operation ID after a lost ACK", async () => {
    const { provider, server } = await setup();
    server.acknowledge = false;
    provider.doc.getText("text").insert(0, "lost ack ");
    const saving = provider.flush();
    await vi.waitFor(() => expect(server.updates()).toHaveLength(1));
    server.acknowledge = true;
    server.sockets[0].close();
    await expect(saving).resolves.toBe(2);
    expect(server.updates()).toHaveLength(2);
    expect(server.updates()[0]).toEqual(server.updates()[1]);
    expect(server.version).toBe(2);
    expect(server.doc.getText("text").toString()).toBe("lost ack server");
  });

  it("restores offline binary identity and stable outbox operations after reload", async () => {
    const { provider, server, factory } = await setup({ reconnectDelayMs: 100000 });
    server.sockets[0].close();
    provider.doc.getText("text").delete(0, 1);
    provider.doc.getText("text").insert(0, "offline ");
    await expect(provider.flush({ timeoutMs: 5 })).rejects.toThrow("保存确认尚未收到");
    const exported = JSON.parse(provider.exportRecovery());
    const vector = Y.encodeStateVector(provider.doc);
    await provider.dispose();
    const restored = (await setup({}, server, factory)).provider;
    await expect(restored.flush()).resolves.toBe(2);
    expect(server.updates()[0].operation_id).toBe(exported.pending[0].operation_id);
    expect(server.doc.getText("text").toString()).toBe("offline erver");
    expect(Y.encodeStateVector(restored.doc)).toEqual(vector);
  });

  it("replays multiple offline operations in their original sequence after IndexedDB reload", async () => {
    const { provider, server, factory } = await setup({ reconnectDelayMs: 100000 });
    server.acknowledge = false;
    const idsMock = vi.spyOn(crypto, "randomUUID").mockReturnValueOnce("ffffffff-ffff-4fff-8fff-ffffffffffff").mockReturnValueOnce("00000000-0000-4000-8000-000000000001");
    provider.doc.getText("text").insert(0, "first ");
    await expect(provider.flush({ timeoutMs: 5 })).rejects.toThrow();
    server.sockets[0].close();
    provider.doc.getText("text").insert(6, "second ");
    await expect(provider.flush({ timeoutMs: 5 })).rejects.toThrow();
    const ids = JSON.parse(provider.exportRecovery()).pending.map((operation: Wire) => operation.operation_id);
    expect(ids).toHaveLength(2); expect(ids[0] > ids[1]).toBe(true);
    idsMock.mockRestore();
    await provider.dispose();
    server.acknowledge = true;
    const restored = (await setup({}, server, factory)).provider;
    await restored.flush();
    expect(server.updates().slice(1).map(operation => operation.operation_id)).toEqual(ids);
    expect(server.doc.getText("text").toString()).toBe("first second server");
  });

  it("coalesces continuous input behind a slow ACK into one unsent durable operation", async () => {
    const { provider, server, factory } = await setup({ reconnectDelayMs: 100000 });
    server.acknowledge = false;
    provider.doc.getText("text").insert(0, "first ");
    await expect(provider.flush({ timeoutMs: 2 })).rejects.toThrow();
    let unsentId: string | undefined;
    for (let i = 0; i < 30; i++) {
      provider.doc.getText("text").insert(6, `${i},`);
      await expect(provider.flush({ timeoutMs: 2 })).rejects.toThrow();
      expect(provider.getSnapshot().pendingCount).toBe(2);
      const pending = JSON.parse(provider.exportRecovery()).pending;
      unsentId ??= pending[1].operation_id;
      expect(pending[1].operation_id).toBe(unsentId);
    }
    const latest = provider.doc.getText("text").toString();
    expect(server.updates()).toHaveLength(1);
    await provider.dispose(); server.acknowledge = true;
    const restored = (await setup({}, server, factory)).provider;
    await restored.flush();
    expect(server.doc.getText("text").toString()).toBe(latest);
    expect(server.updates().at(-1)!.operation_id).toBe(unsentId);
    expect(server.receipts.size).toBe(2);
  });

  it("does not steal a live tab's mutable outbox when a cloned tab claims its own lane", async () => {
    const { provider: first, server, factory } = await setup({ reconnectDelayMs: 100000 });
    server.acknowledge = false;
    first.doc.getText("text").insert(0, "first ");
    await expect(first.flush({ timeoutMs: 2 })).rejects.toThrow();
    first.doc.getText("text").insert(0, "unsent ");
    await expect(first.flush({ timeoutMs: 2 })).rejects.toThrow();
    const firstOptions = laneOptions(factory), clonedValues = new Map<string, string>();
    const cloneOptions = { ...firstOptions, storage: { getItem: (key: string) => clonedValues.get(key) ?? firstOptions.storage!.getItem(key), setItem: (key: string, value: string) => { clonedValues.set(key, value); } } };
    const second = (await setup({ laneOptions: cloneOptions }, server, factory)).provider;
    expect(second.getSnapshot().pendingCount).toBe(0);
    expect(second.doc.getText("text").toString()).toBe("first server");
    first.doc.getText("text").insert(0, "coalesced ");
    await expect(first.flush({ timeoutMs: 2 })).rejects.toThrow();
    server.acknowledge = true;
    second.doc.getText("text").insert(0, "second tab "); await second.flush();
    server.sockets[0].message({ type: "ack", epoch, operation_id: server.updates()[0].operation_id, content_version: 2 });
    await first.flush();
    expect(first.getSnapshot()).toMatchObject({ status: "online", pendingCount: 0 });
    expect(second.getSnapshot()).toMatchObject({ status: "online", pendingCount: 0 });
    expect(server.doc.getText("text").toString()).toContain("coalesced unsent");
    expect(server.doc.getText("text").toString()).toContain("first");
    expect(server.doc.getText("text").toString()).toContain("second tab");
  });

  it("preserves failed structural edits when the server rejects a removed target before broadcast", async () => {
    const { provider, server } = await setup();
    server.acknowledge = false;
    provider.doc.getText("text").delete(0, 1);
    const saving = provider.flush();
    await vi.waitFor(() => expect(server.updates()).toHaveLength(1));
    server.sockets[0].message({ type: "error", status: 409, code: "COLLABORATION_TARGET_REMOVED", message: "目标已被并发移动或删除" });
    await expect(saving).rejects.toThrow("目标已被并发移动或删除");
    expect(provider.getSnapshot()).toMatchObject({ status: "recovery", readOnly: true, pendingCount: 1, isSaved: false });
    expect(provider.doc.getText("text").toString()).toBe("erver");
    expect(JSON.parse(provider.exportRecovery()).pending).toHaveLength(1);
  });

  it("freezes writes on permission loss and refreshes authentication without changing operation IDs", async () => {
    const refreshToken = vi.fn(async () => "refreshed");
    const { provider, server } = await setup({ refreshToken });
    server.sockets[0].message({ type: "error", status: 401 });
    await vi.waitFor(() => expect(server.messages.filter(message => message.type === "authenticate")).toHaveLength(2));
    expect(server.messages.filter(message => message.type === "authenticate")[1].token).toBe("refreshed");
    server.acknowledge = false;
    provider.doc.getText("text").insert(0, "keep ");
    const saving = provider.flush();
    await vi.waitFor(() => expect(server.updates()).toHaveLength(1));
    server.sockets.at(-1)!.message({ type: "error", status: 403, message: "编辑权限已撤销" });
    await expect(saving).rejects.toThrow("编辑权限已撤销");
    expect(provider.getSnapshot()).toMatchObject({ status: "read_only", pendingCount: 1, isSaved: false });
    expect(refreshToken).toHaveBeenCalledTimes(1);
  });

  it("retains old epochs and account scopes for export without merging them into a new document", async () => {
    const { provider, server, factory } = await setup({ reconnectDelayMs: 100000 });
    server.sockets[0].close();
    provider.doc.getText("text").insert(0, "old epoch ");
    await expect(provider.flush({ timeoutMs: 5 })).rejects.toThrow();
    await provider.dispose();
    const next = await setup({ initialState: { ...server.state(), epoch: "new-epoch" } }, server, factory, "recovery");
    // The socket still advertises the old epoch, so it must stop before applying.
    expect(next.provider.getSnapshot().status).toBe("recovery");
    expect(next.provider.doc.getText("text").toString()).toBe("server");
    expect(next.provider.getSnapshot().recoveries).toHaveLength(1);
    expect(JSON.parse(next.provider.exportRecovery()).previous_epochs[0].pending).toHaveLength(1);
    const anotherAccount = (await setup({ userId: "other-account" }, server, factory)).provider;
    expect(anotherAccount.getSnapshot().recoveries).toHaveLength(0);
    expect(anotherAccount.doc.getText("text").toString()).toBe("server");
  });

  it("keeps copied table intent in the exact persisted operation that inserts it", async () => {
    const { provider, server } = await setup();
    const copy = { block_id: documentId, source: { workspace_id: workspaceId, document_id: documentId, document_version: 1, table_id: epoch } };
    provider.doc.getText("text").insert(0, "earlier ");
    provider.stageTableCopies([copy]);
    const table = new Y.XmlElement("orbisComponent"); table.setAttribute("orbisId", documentId); provider.doc.getXmlFragment("body").insert(0, [table]);
    provider.doc.getText("text").insert(0, "table ");
    await provider.flush();
    expect(server.updates().filter(operation => operation.table_copies)).toHaveLength(1);
    expect(server.updates().find(operation => operation.table_copies)!.table_copies).toEqual([copy]);
    expect((server.doc.getXmlFragment("body").get(0) as Y.XmlElement).getAttribute("orbisId")).toBe(documentId);
  });

  it("rolls back canceled table-copy staging before the next unrelated edit", async () => {
    const { provider, server } = await setup();
    const table = new Y.XmlElement("orbisComponent"); table.setAttribute("orbisId", documentId); provider.doc.getXmlFragment("body").insert(0, [table]);
    await provider.flush();
    const rollback = provider.stageTableCopies([{ block_id: documentId, source: { workspace_id: workspaceId, document_id: documentId, document_version: 1, table_id: epoch } }]);
    rollback();
    provider.doc.getText("text").insert(0, "unrelated ");
    await provider.flush();
    expect(server.updates().at(-1)!.table_copies).toBeUndefined();
  });

  it("starts sending on a ready-only handshake and keeps unseen peer versions in reconnect range", async () => {
    const server = new FakeServer(); server.readyOnly = true;
    const { provider } = await setup({}, server);
    provider.doc.getText("text").insert(0, "own ");
    await provider.flush();
    expect(provider.getSnapshot().contentVersion).toBe(2);
    server.sockets[0].close();
    await vi.waitFor(() => expect(server.messages.filter(message => message.type === "authenticate")).toHaveLength(2));
    expect(server.messages.filter(message => message.type === "authenticate")[1].after_version).toBe(1);
  });

  it("keeps an offline draft separate when the same account later opens read-only", async () => {
    const { provider, server, factory } = await setup({ reconnectDelayMs: 100000 });
    server.sockets[0].close();
    provider.doc.getText("text").insert(0, "private draft ");
    await expect(provider.flush({ timeoutMs: 5 })).rejects.toThrow();
    await provider.dispose();
    const viewer = (await setup({ readOnly: true }, server, factory)).provider;
    expect(viewer.doc.getText("text").toString()).toBe("server");
    expect(viewer.getSnapshot()).toMatchObject({ readOnly: true, pendingCount: 0 });
    expect(viewer.getSnapshot().recoveries).toHaveLength(1);
    expect(server.updates()).toHaveLength(0);
    expect(JSON.parse(viewer.exportRecovery()).previous_epochs[0].pending).toHaveLength(1);
  });

  it("sends original block targets for text deletions and preserves a draft before applying a concurrent move", async () => {
    const server = new FakeServer("");
    const paragraph = new Y.XmlElement("paragraph"), text = new Y.XmlText();
    paragraph.setAttribute("orbisId", documentId);
    paragraph.insert(0, [text]);
    server.doc.getXmlFragment("body").insert(0, [paragraph]);
    text.insert(0, "original");
    const { provider } = await setup({}, server);
    server.acknowledge = false;
    const localParagraph = provider.doc.getXmlFragment("body").get(0) as Y.XmlElement;
    (localParagraph.get(0) as Y.XmlText).delete(0, 1);
    const saving = provider.flush();
    const rejected = expect(saving).rejects.toThrow();
    await vi.waitFor(() => expect(server.updates()).toHaveLength(1));
    expect(server.updates()[0].targets).toContainEqual(paragraph._item!.id);
    const moved = paragraph.clone();
    server.doc.getXmlFragment("body").delete(0, 1);
    server.doc.getXmlFragment("body").insert(0, [moved]);
    server.sockets[0].message({ type: "state", data: { ...server.state(), content_version: 3 } });
    await rejected;
    expect(provider.getSnapshot().readOnly).toBe(true);
    expect((localParagraph.get(0) as Y.XmlText).toString()).toBe("riginal");
    expect(provider.getSnapshot().pendingCount).toBe(1);
  });

  it("proves structural content before the whole text-and-move batch", async () => {
    const server = new FakeServer("");
    const paragraph = new Y.XmlElement("paragraph"), text = new Y.XmlText(); paragraph.setAttribute("orbisId", documentId); paragraph.insert(0, [text]); server.doc.getXmlFragment("body").insert(0, [paragraph]); text.insert(0, "original");
    const expected = fingerprintElement(paragraph);
    const { provider } = await setup({}, server);
    const local = provider.doc.getXmlFragment("body").get(0) as Y.XmlElement;
    (local.get(0) as Y.XmlText).insert(0, "own text ");
    const moved = local.clone();
    provider.doc.getXmlFragment("body").delete(0, 1); provider.doc.getXmlFragment("body").insert(0, [moved]);
    await provider.flush();
    expect(server.updates()).toHaveLength(1);
    expect(server.updates()[0].targets).toContainEqual({ ...paragraph._item!.id, content_hash: expected });
  });

  it("proves owned list items when deleting a wrapper without a block identity", async () => {
    const server = new FakeServer("");
    const list = new Y.XmlElement("bulletList"), item = new Y.XmlElement("listItem"), paragraph = new Y.XmlElement("paragraph"), text = new Y.XmlText();
    item.setAttribute("orbisId", documentId); paragraph.insert(0, [text]); item.insert(0, [paragraph]); list.insert(0, [item]); server.doc.getXmlFragment("body").insert(0, [list]); text.insert(0, "list item");
    const expected = fingerprintElement(item);
    const { provider } = await setup({}, server);
    provider.doc.getXmlFragment("body").delete(0, 1); await provider.flush();
    expect(server.updates()[0].targets).toContainEqual({ ...item._item!.id, content_hash: expected });
  });

  it("bases a later structural proof on preceding queued edits despite an uncertain ACK", async () => {
    const server = new FakeServer("");
    const paragraph = new Y.XmlElement("paragraph"), text = new Y.XmlText(); paragraph.setAttribute("orbisId", documentId); paragraph.insert(0, [text]); server.doc.getXmlFragment("body").insert(0, [paragraph]); text.insert(0, "original");
    const { provider } = await setup({}, server);
    server.acknowledge = false;
    const local = provider.doc.getXmlFragment("body").get(0) as Y.XmlElement;
    (local.get(0) as Y.XmlText).insert(0, "queued ");
    const first = provider.flush();
    await vi.waitFor(() => expect(server.updates()).toHaveLength(1));
    const expected = fingerprintElement(paragraph);
    const moved = local.clone(); provider.doc.getXmlFragment("body").delete(0, 1); provider.doc.getXmlFragment("body").insert(0, [moved]);
    const second = provider.flush();
    await vi.waitFor(() => expect(provider.getSnapshot().pendingCount).toBe(2));
    server.acknowledge = true;
    server.sockets[0].message({ type: "ack", epoch, operation_id: server.updates()[0].operation_id, content_version: 2 });
    await first; await second;
    expect(server.updates()).toHaveLength(2);
    expect(server.updates()[1].targets).toContainEqual({ ...paragraph._item!.id, content_hash: expected });
  });

  it("restores the untouched offline draft before refusing a conflicting newer structural snapshot", async () => {
    const server = new FakeServer("");
    const paragraph = new Y.XmlElement("paragraph"), text = new Y.XmlText(); paragraph.setAttribute("orbisId", documentId); paragraph.insert(0, [text]); server.doc.getXmlFragment("body").insert(0, [paragraph]); text.insert(0, "original");
    const { provider, factory } = await setup({ reconnectDelayMs: 100000 }, server);
    server.sockets[0].close();
    ((provider.doc.getXmlFragment("body").get(0) as Y.XmlElement).get(0) as Y.XmlText).delete(0, 1);
    await expect(provider.flush({ timeoutMs: 5 })).rejects.toThrow();
    await provider.dispose();
    const moved = paragraph.clone(); server.doc.getXmlFragment("body").delete(0, 1); server.doc.getXmlFragment("body").insert(0, [moved]); server.version++;
    const restored = new DocumentCollaborationProvider({ documentId, workspaceId, userId, initialState: server.state(), token: () => "token", persistence: createCollaborationPersistence(factory), socketFactory: server.connect, laneOptions: laneOptions(factory) });
    providers.push(restored);
    await expect(restored.start()).rejects.toThrow("并发操作移动或删除");
    expect(restored.getSnapshot()).toMatchObject({ status: "recovery", readOnly: true, pendingCount: 1 });
    expect(((restored.doc.getXmlFragment("body").get(0) as Y.XmlElement).get(0) as Y.XmlText).toString()).toBe("riginal");
    const backup = JSON.parse(restored.exportRecovery()), decoded = new Y.Doc(); Y.applyUpdate(decoded, decodeCollaborationUpdate(backup.state));
    expect(((decoded.getXmlFragment("body").get(0) as Y.XmlElement).get(0) as Y.XmlText).toString()).toBe("riginal");
    decoded.destroy();
  });

  it("proves each drawing edit against its expected pre-batch content", async () => {
    const server = new FakeServer("");
    const drawing = new Y.XmlElement<any>("orbisDrawing"); drawing.setAttribute("orbisId", documentId); drawing.setAttribute("orbisProps", { scene: "original" }); server.doc.getXmlFragment("body").insert(0, [drawing]);
    const firstProof = fingerprintElement(drawing);
    const { provider } = await setup({}, server);
    const local = provider.doc.getXmlFragment("body").get(0) as Y.XmlElement<any>;
    local.setAttribute("orbisProps", { scene: "stroke 1" }); local.setAttribute("orbisProps", { scene: "stroke 2" });
    await provider.flush();
    expect(server.updates()[0].targets).toContainEqual({ ...drawing._item!.id, content_hash: firstProof });
    const nextProof = fingerprintElement(drawing);
    local.setAttribute("orbisProps", { scene: "stroke 3" }); await provider.flush();
    expect(server.updates()[1].targets).toContainEqual({ ...drawing._item!.id, content_hash: nextProof });
  });

  it("keeps the local drawing intact before applying a conflicting remote drawing attribute", async () => {
    const server = new FakeServer("");
    const drawing = new Y.XmlElement<any>("orbisDrawing"); drawing.setAttribute("orbisId", documentId); drawing.setAttribute("orbisProps", { scene: "original" }); server.doc.getXmlFragment("body").insert(0, [drawing]);
    const peer = new Y.Doc({ gc: false }); Y.applyUpdate(peer, Y.encodeStateAsUpdate(server.doc)); peer.clientID = 0xffffffff;
    const { provider } = await setup({}, server); server.acknowledge = false;
    const local = provider.doc.getXmlFragment("body").get(0) as Y.XmlElement<any>;
    local.setAttribute("orbisProps", { scene: "local strokes" });
    const saving = provider.flush(), rejected = expect(saving).rejects.toThrow("属性");
    await vi.waitFor(() => expect(server.updates()).toHaveLength(1));
    (peer.getXmlFragment("body").get(0) as Y.XmlElement<any>).setAttribute("orbisProps", { scene: "peer strokes" });
    server.sockets[0].message({ type: "state", data: { ...server.state(), state: encodeCollaborationUpdate(Y.encodeStateAsUpdate(peer)), content_version: 3 } });
    await rejected;
    expect(provider.getSnapshot()).toMatchObject({ status: "recovery", pendingCount: 1 });
    expect(local.getAttribute("orbisProps")).toEqual({ scene: "local strokes" });
    peer.destroy();
  });

  it("proves compound component properties and preserves the local title before a competing map wins", async () => {
    const server = new FakeServer("");
    const element = new Y.XmlElement<any>("orbisComponent"); element.setAttribute("orbisId", documentId); element.setAttribute("kind", "callout"); element.setAttribute("orbisProps", { title: "Original title", tone: "info" }); server.doc.getXmlFragment("body").insert(0, [element]);
    const expected = fingerprintElement(element), peer = new Y.Doc({ gc: false }); Y.applyUpdate(peer, Y.encodeStateAsUpdate(server.doc)); peer.clientID = 0xffffffff;
    const { provider } = await setup({}, server); server.acknowledge = false;
    const local = provider.doc.getXmlFragment("body").get(0) as Y.XmlElement<any>;
    local.setAttribute("orbisProps", { title: "New title", tone: "info" });
    const saving = provider.flush(), rejected = expect(saving).rejects.toThrow("属性");
    await vi.waitFor(() => expect(server.updates()).toHaveLength(1));
    expect(server.updates()[0].targets).toContainEqual({ ...element._item!.id, content_hash: expected });
    expect(server.updates()[0].targets[0]).not.toHaveProperty("atomic");
    (peer.getXmlFragment("body").get(0) as Y.XmlElement<any>).setAttribute("orbisProps", { title: "Original title", tone: "warning" });
    server.sockets[0].message({ type: "state", data: { ...server.state(), state: encodeCollaborationUpdate(Y.encodeStateAsUpdate(peer)), content_version: 3 } });
    await rejected;
    expect(provider.getSnapshot()).toMatchObject({ status: "recovery", pendingCount: 1 });
    expect(local.getAttribute("orbisProps")).toEqual({ title: "New title", tone: "info" });
    peer.destroy();
  });

  it("uses the owning table proof for compound cell properties and width arrays", async () => {
    const server = new FakeServer("");
    const table = new Y.XmlElement<any>("table"), row = new Y.XmlElement("tableRow"), cell = new Y.XmlElement<any>("tableCell"), paragraph = new Y.XmlElement("paragraph"), text = new Y.XmlText();
    table.setAttribute("orbisId", documentId); table.setAttribute("orbisProps", {}); table.setAttribute("columnWidths", [100]); cell.setAttribute("orbisCellProps", {}); cell.setAttribute("colwidth", [100]); paragraph.insert(0, [text]); cell.insert(0, [paragraph]); row.insert(0, [cell]); table.insert(0, [row]); server.doc.getXmlFragment("body").insert(0, [table]); text.insert(0, "cell");
    const { provider } = await setup({}, server);
    const localTable = provider.doc.getXmlFragment("body").get(0) as Y.XmlElement<any>, localCell = (localTable.get(0) as Y.XmlElement).get(0) as Y.XmlElement<any>;
    const changes = [{ node: localCell, attribute: "orbisCellProps", value: { textColor: "#aabbcc" } }, { node: localCell, attribute: "colwidth", value: [220] }, { node: localTable, attribute: "columnWidths", value: [220] }];
    for (const [index, change] of changes.entries()) {
      const expected = fingerprintElement(table);
      change.node.setAttribute(change.attribute, change.value); await provider.flush();
      expect(server.updates()[index].targets).toContainEqual({ ...table._item!.id, content_hash: expected });
    }
  });

  it("durably keeps a rejected outbox before opening the server in a fresh persistent lane", async () => {
    const { provider, server, factory } = await setup(); server.rejectUpdates = true;
    provider.doc.getText("text").insert(0, "rejected ");
    await expect(provider.flush()).rejects.toThrow("需要恢复");
    await provider.saveRecovery();
    const scope = collaborationScope({ origin: location.origin, userId, workspaceId, documentId }), adapter = createCollaborationPersistence(factory);
    const saved = await adapter.read(scope);
    expect(saved).toHaveLength(1); expect(saved[0].pending).toHaveLength(1);
    const recovered = new Y.Doc(); Y.applyUpdate(recovered, saved[0].state); expect(recovered.getText("text").toString()).toBe("rejected server"); recovered.destroy();
    const previous = laneOptions(factory), fresh = { ...previous, storage: { getItem: () => null, setItem: (key: string, value: string) => previous.storage!.setItem(key, value) } };
    const current = (await setup({ laneOptions: fresh }, server, factory)).provider;
    expect(current.doc.getText("text").toString()).toBe("server"); expect(current.getSnapshot().pendingCount).toBe(0); expect(current.getSnapshot().recoveries).toHaveLength(1);
    server.rejectUpdates = false;
    current.doc.getText("text").insert(0, "new "); await current.flush(); await current.dispose();
    const reopened = (await setup({}, server, factory)).provider;
    expect(reopened.doc.getText("text").toString()).toBe("new server"); expect(reopened.getSnapshot()).toMatchObject({ status: "online", pendingCount: 0 });
    expect((await adapter.read(scope)).find(record => record.lane === saved[0].lane)?.pending).toHaveLength(1);
    await adapter.close();
  });

  it("stays offline until an online event and retries the same uncertain operation", async () => {
    const network = new FakeNetwork(), { provider, server } = await setup({ network }); server.acknowledge = false;
    provider.doc.getText("text").insert(0, "offline event ");
    await expect(provider.flush({ timeoutMs: 5 })).rejects.toThrow();
    const original = server.updates()[0];
    network.set(false);
    expect(provider.getSnapshot()).toMatchObject({ status: "offline", isSaved: false });
    expect(server.sockets[0].readyState).toBe(3);
    await provider.saveRecovery();
    expect(server.sockets).toHaveLength(1);
    server.acknowledge = true; network.set(true);
    await provider.flush();
    expect(server.updates()[1]).toEqual(original);
    expect(server.receipts.size).toBe(1);
    await provider.dispose(); expect(network.listeners.size).toBe(0);
  });

  it("does not establish a socket while initially offline and keeps new edits durable", async () => {
    const network = new FakeNetwork(false), { provider, server } = await setup({ network }, new FakeServer(), new IDBFactory(), "offline");
    expect(server.sockets).toHaveLength(0);
    provider.doc.getText("text").insert(0, "initially offline ");
    await expect(provider.flush({ timeoutMs: 5 })).rejects.toThrow();
    await provider.saveRecovery();
    expect(server.sockets).toHaveLength(0);
    network.set(true); await provider.flush();
    expect(server.doc.getText("text").toString()).toBe("initially offline server");
  });

  it("bounds a blackholed authentication handshake and clears retries and listeners on disposal", async () => {
    const network = new FakeNetwork(), server = new FakeServer(); server.blackholeAuthentication = true;
    const provider = new DocumentCollaborationProvider({ documentId, workspaceId, userId, initialState: server.state(), token: () => "token", persistence: createCollaborationPersistence(new IDBFactory()), socketFactory: server.connect, network, connectionTimeoutMs: 5, reconnectDelayMs: 1, laneOptions: { storage: null, locks: null, createChannel: null, settleMs: 0 } });
    providers.push(provider);
    const statuses: string[] = []; provider.subscribe(() => statuses.push(provider.getSnapshot().status));
    await provider.start();
    await vi.waitFor(() => expect(server.sockets.length).toBeGreaterThan(1));
    expect(statuses).toContain("offline");
    network.set(false); expect(provider.getSnapshot().status).toBe("offline");
    await provider.dispose(); const count = server.sockets.length;
    network.set(true);
    expect(network.listeners.size).toBe(0); expect(server.sockets.every(socket => socket.readyState === 3)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(server.sockets).toHaveLength(count);
  });

  it("keeps pending writes retryable when authentication refresh is interrupted by offline", async () => {
    const network = new FakeNetwork();
    let first = true;
    const refreshToken = vi.fn(async (signal?: AbortSignal) => {
      if (!first) return "refreshed";
      first = false;
      return new Promise<string | null>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new TypeError("network unavailable")), { once: true }));
    });
    const { provider, server } = await setup({ network, refreshToken, connectionTimeoutMs: 100 }); server.acknowledge = false;
    provider.doc.getText("text").insert(0, "keep during refresh "); await expect(provider.flush({ timeoutMs: 5 })).rejects.toThrow();
    const original = server.updates()[0]; server.requiredToken = "refreshed"; server.sockets[0].message({ type: "error", status: 401 });
    network.set(false);
    await vi.waitFor(() => expect(provider.getSnapshot()).toMatchObject({ status: "offline", readOnly: false, pendingCount: 1 }));
    server.acknowledge = true; network.set(true);
    await provider.flush();
    expect(server.updates()[1]).toEqual(original);
    expect(refreshToken).toHaveBeenCalledTimes(2);
    expect(provider.getSnapshot()).toMatchObject({ status: "online", isSaved: true, readOnly: false });
  });

  it("treats a confirmed authentication refresh failure as read-only", async () => {
    const { provider, server } = await setup({ refreshToken: async () => { throw new ApiError(401, "登录已失效", "AUTH_REQUIRED"); } });
    server.sockets[0].message({ type: "error", status: 401 });
    await vi.waitFor(() => expect(provider.getSnapshot()).toMatchObject({ status: "read_only", readOnly: true }));
  });
});

it("retains separate safe binary snapshots for browser lanes when another lane moves a block", async () => {
  const factory = new IDBFactory(), persistence = createCollaborationPersistence(factory);
  const scope = collaborationScope({ origin: location.origin, userId, workspaceId, documentId });
  const left = new Y.Doc({ gc: false }), right = new Y.Doc({ gc: false });
  const element = new Y.XmlElement("paragraph"), text = new Y.XmlText(); element.setAttribute("orbisId", documentId); element.insert(0, [text]); left.getXmlFragment("body").insert(0, [element]); text.insert(0, "old text");
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
  (element.get(0) as Y.XmlText).insert(0, "local ");
  const original = right.getXmlFragment("body").get(0) as Y.XmlElement, moved = original.clone();
  right.getXmlFragment("body").delete(0, 1); right.getXmlFragment("body").insert(0, [moved]);
  await persistence.write({ scope, epoch, lane: "local", state: Y.encodeStateAsUpdate(left), contentVersion: 1, pending: [] }, [{ operation_id: "local", update: encodeCollaborationUpdate(Y.encodeStateAsUpdate(left)) }], []);
  await persistence.write({ scope, epoch, lane: "other", state: Y.encodeStateAsUpdate(right), contentVersion: 2, pending: [] }, [{ operation_id: "other", update: encodeCollaborationUpdate(Y.encodeStateAsUpdate(right)) }], []);
  const snapshots = await persistence.read(scope);
  expect(snapshots).toHaveLength(2);
  const restored = new Y.Doc(); Y.applyUpdate(restored, snapshots.find(snapshot => snapshot.lane === "local")!.state);
  expect(((restored.getXmlFragment("body").get(0) as Y.XmlElement).get(0) as Y.XmlText).toString()).toBe("local old text");
  await persistence.close(); left.destroy(); right.destroy(); restored.destroy();
});

it("atomically merges shared-browser state and outboxes without resurrecting acknowledged operations", async () => {
  const factory = new IDBFactory(), first = createCollaborationPersistence(factory), second = createCollaborationPersistence(factory);
  const scope = collaborationScope({ origin: location.origin, userId, workspaceId, documentId });
  const left = new Y.Doc(), right = new Y.Doc();
  left.getText("text").insert(0, "left"); right.getText("text").insert(0, "right");
  const a = { operation_id: "a", update: encodeCollaborationUpdate(Y.encodeStateAsUpdate(left)) }, b = { operation_id: "b", update: encodeCollaborationUpdate(Y.encodeStateAsUpdate(right)) };
  await Promise.all([first.write({ scope, epoch, state: Y.encodeStateAsUpdate(left), contentVersion: 1, pending: [a] }, [a], []), second.write({ scope, epoch, state: Y.encodeStateAsUpdate(right), contentVersion: 1, pending: [b] }, [b], [])]);
  const stored = (await first.read(scope))[0];
  expect(stored.pending.map(operation => operation.operation_id).sort()).toEqual(["a", "b"]);
  const merged = new Y.Doc(); Y.applyUpdate(merged, stored.state);
  expect(merged.getText("text").length).toBe(9);
  await first.write(stored, [], ["a"]);
  await second.write(stored, [], []);
  expect((await first.read(scope))[0].pending.map(operation => operation.operation_id)).toEqual(["b"]);
  await first.close(); await second.close(); left.destroy(); right.destroy(); merged.destroy();
});
