import { describe, expect, it } from "vitest";
import { resolveDraftLane, withDraftLane, type DraftLaneChannel } from "./draft-lanes";
import { createDraftCheckpointController, type DraftCheckpoint, type DraftCheckpointAdapter, type DraftCheckpointInput } from "./draft-checkpoints";

const scope = "origin:user:workspace:note";
function storage(initial?: string) {
  const values = new Map<string, string>(initial ? [["orbis.draft-lane:" + scope, initial]] : []);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function fakeLocks() {
  const held = new Set<string>();
  return { request: async (key: string, _options: unknown, action: (lock: object | null) => Promise<void>) => { if (held.has(key)) return action(null); held.add(key); try { await action({ name: key }); } finally { held.delete(key); } } } as unknown as Pick<LockManager, "request">;
}
function channels() {
  const listeners = new Map<object, EventListener>();
  const factory = (): DraftLaneChannel => {
    const channel = {
      postMessage(value: unknown) { queueMicrotask(() => { for (const [target, listener] of listeners) if (target !== channel) listener(new MessageEvent("message", { data: value })); }); },
      addEventListener(_type: string, listener: EventListener) { listeners.set(channel, listener); },
      removeEventListener() { listeners.delete(channel); }, close() { listeners.delete(channel); },
    };
    return channel as unknown as DraftLaneChannel;
  };
  return factory;
}
function memoryAdapter(): DraftCheckpointAdapter & { records: Map<string, DraftCheckpoint> } {
  const records = new Map<string, DraftCheckpoint>();
  return { records, async read(key) { return records.get(key) ?? null; }, async put(record) { const previous = records.get(record.scopeKey); if (!previous || previous.sequence <= record.sequence) records.set(record.scopeKey, record); }, async remove(key, sequence) { const record = records.get(key); if (record && record.sequence <= sequence) records.delete(key); } };
}
const input = (text: string): DraftCheckpointInput => ({ saved: { title: "Document", version: 1, blocks: { schema_version: 2, editor: "blocknote", blocks: [] } }, current: { title: text, version: 1, blocks: { schema_version: 2, editor: "blocknote", blocks: [] } }, window: null, descriptors: [] });
const ids = (prefix: string) => { let counter = 0; return () => `${prefix}-${++counter}`; };

describe("tab draft lanes", () => {
  it("forks a cloned sessionStorage lane while the original tab owns it", async () => {
    const locks = fakeLocks(), createChannel = channels();
    const first = await resolveDraftLane(scope, { storage: storage("original-lane"), locks, createChannel, randomId: ids("first-tab"), settleMs: 1 });
    const cloned = await resolveDraftLane(scope, { storage: storage("original-lane"), locks, createChannel, randomId: ids("popup-tab"), settleMs: 1 });
    expect(first.laneId).toBe("original-lane"); expect(cloned.laneId).not.toBe(first.laneId); expect(cloned.collided).toBe(true);
    first.release(); cloned.release();
  });
  it("same-tab reload reuses its released lane and recovers its draft", async () => {
    const locks = fakeLocks(), savedStorage = storage(), adapter = memoryAdapter();
    const first = await resolveDraftLane(scope, { storage: savedStorage, locks, createChannel: null, randomId: ids("same-tab"), settleMs: 0 });
    const controller = createDraftCheckpointController({ scopeKey: withDraftLane(scope, first.laneId), adapter }); controller.schedule(input("Offline edit")); await controller.dispose(); first.release();
    await first.released;
    const reloaded = await resolveDraftLane(scope, { storage: savedStorage, locks, createChannel: null, randomId: ids("reload-tab"), settleMs: 0 });
    expect(reloaded.laneId).toBe(first.laneId);
    const reopened = createDraftCheckpointController({ scopeKey: withDraftLane(scope, reloaded.laneId), adapter }); expect((await reopened.read())?.current.title).toBe("Offline edit"); await reopened.dispose(); reloaded.release();
  });
  it("two controllers at the same note and sequence retain independent edits and acknowledgements", async () => {
    const adapter = memoryAdapter();
    const a = createDraftCheckpointController({ scopeKey: withDraftLane(scope, "tab-one"), adapter }), b = createDraftCheckpointController({ scopeKey: withDraftLane(scope, "tab-two"), adapter });
    expect(a.schedule(input("A offline"))).toBe(1); expect(b.schedule(input("B offline"))).toBe(1); await Promise.all([a.flush(), b.flush()]);
    expect(adapter.records.size).toBe(2); await a.acknowledge(1); expect(adapter.records.size).toBe(1); expect((await b.read())?.current.title).toBe("B offline"); await Promise.all([a.dispose(), b.dispose()]);
  });
  it("uncertain ownership forks and keeps the old lane as a recovery choice", async () => {
    const createChannel = channels();
    const active = await resolveDraftLane(scope, { storage: storage(), locks: null, createChannel, randomId: ids("active-tab"), settleMs: 1 });
    const clone = await resolveDraftLane(scope, { storage: storage(active.laneId), locks: null, createChannel, randomId: ids("clone-tab"), settleMs: 1 });
    expect(clone.ownership).toBe("unavailable"); expect(clone.laneId).not.toBe(active.laneId); expect(clone.previousLaneId).toBe(active.laneId); expect(clone.collided).toBe(true); active.release(); clone.release();
  });
  it("simultaneous cloned claims choose different physical lanes atomically", async () => {
    const locks = fakeLocks(), createChannel = channels();
    const [a, b] = await Promise.all([resolveDraftLane(scope, { storage: storage("copied-candidate"), locks, createChannel, randomId: ids("tab-first"), settleMs: 1 }), resolveDraftLane(scope, { storage: storage("copied-candidate"), locks, createChannel, randomId: ids("tab-second"), settleMs: 1 })]);
    expect(a.laneId).not.toBe(b.laneId); expect([a, b].some(lane => lane.collided)).toBe(true); a.release(); b.release();
  });
});
