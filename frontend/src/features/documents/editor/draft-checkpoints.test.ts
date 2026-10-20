import { afterEach, describe, expect, it, vi } from "vitest";
import { checkpointRecoveryIssue, createDraftCheckpointController, draftScopeKey, type DraftCheckpoint, type DraftCheckpointAdapter, type DraftCheckpointInput } from "./draft-checkpoints";
const draft = (text: string, version = 1) => ({ title: "Document", version, blocks: { schema_version: 2 as const, editor: "blocknote" as const, blocks: [{ id: "p1", type: "paragraph" as const, props: {}, content: [{ type: "text" as const, text }], children: [] }] } });
const input = (text: string): DraftCheckpointInput => ({ saved: draft("baseline"), current: draft(text), window: { noteId: "note", version: 1, cursor:"opaque-next",loaded:32, hasMore: true, bounded: true }, descriptors: [["p1", { id: "p1", parent_id: null, child_count: 0, has_children: false, children_loaded: true, payload_loaded: true, payload_bytes: 128,cursor:null,loaded_count:0 }]] });
function memoryAdapter(): DraftCheckpointAdapter & { records: Map<string, DraftCheckpoint>; writes: DraftCheckpoint[] } {
  const records = new Map<string, DraftCheckpoint>(), writes: DraftCheckpoint[] = [];
  return { records, writes, async read(scope) { return records.get(scope) ?? null; }, async put(value) { writes.push(value); const previous = records.get(value.scopeKey); if (!previous || previous.sequence <= value.sequence) records.set(value.scopeKey, value); }, async remove(scope, through) { const value = records.get(scope); if (value && value.sequence <= through) records.delete(scope); } };
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
afterEach(() => vi.useRealTimers());
describe("persistent draft checkpoints", () => {
  it("coalesces typing without materializing the draft on each keystroke", async () => {
    vi.useFakeTimers();
    const adapter = memoryAdapter(), latest = vi.fn(() => input("final"));
    const controller = createDraftCheckpointController({ scopeKey: "scope", adapter });
    for (let index = 0; index < 100; index++) controller.schedule(latest);
    expect(latest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(249); expect(adapter.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); expect(latest).toHaveBeenCalledTimes(1); expect(adapter.writes).toHaveLength(1); expect(adapter.records.get("scope")?.sequence).toBe(100);
    await controller.dispose();
  });
  it("serializes newer checkpoints behind an in-flight write", async () => {
    const adapter = memoryAdapter(), gate = deferred(), originalPut = adapter.put;
    adapter.put = async value => { if (value.sequence === 1) await gate.promise; await originalPut(value); };
    const controller = createDraftCheckpointController({ scopeKey: "scope", adapter });
    controller.schedule(input("first")); const first = controller.flush(); await Promise.resolve();
    controller.schedule(input("newer")); const second = controller.flush(); expect(adapter.writes).toHaveLength(0);
    gate.resolve(); await Promise.all([first, second]); expect(adapter.writes.map(record => record.sequence)).toEqual([1, 2]);
    expect(adapter.records.get("scope")?.current.blocks.blocks[0].content).toEqual([{ type: "text", text: "newer" }]); await controller.dispose();
  });
  it("late server acknowledgement keeps newer edits and cancels acknowledged pending data", async () => {
    const adapter = memoryAdapter(), controller = createDraftCheckpointController({ scopeKey: "scope", adapter });
    const acknowledged = controller.schedule(input("submitted")); await controller.flush(); controller.schedule(input("newer unsent edit"));
    await controller.acknowledge(acknowledged); await controller.flush(); expect(adapter.records.get("scope")?.sequence).toBe(2);
    await controller.acknowledge(2); expect(adapter.records.has("scope")).toBe(false);
    controller.schedule(input("submitted again")); await controller.acknowledge(3); await controller.flush(); expect(adapter.records.has("scope")).toBe(false); await controller.dispose();
  });
  it("restores exact window and child descriptors then continues the sequence", async () => {
    const value = input("unsaved");
    value.descriptors[0][1] = { ...value.descriptors[0][1], child_count: 10000, has_children: true, children_loaded: false, cursor: null, loaded_count: 32 };
    value.descriptors.push(["oversized", { id: "oversized", parent_id: null, child_count: 0, has_children: false, children_loaded: true, payload_loaded: false, payload_bytes: 300000, cursor: null, loaded_count: 0 }]);
    const adapter = memoryAdapter(), first = createDraftCheckpointController({ scopeKey: "scope", adapter }); first.schedule(value); await first.dispose();
    const reopened = createDraftCheckpointController({ scopeKey: "scope", adapter }), restored = await reopened.read();
    expect(restored?.window).toEqual(value.window); expect(restored?.descriptors).toEqual(value.descriptors);
    expect(restored?.saved.blocks.blocks[0].content).toEqual([{ type: "text", text: "baseline" }]); expect(reopened.schedule(input("after reopen"))).toBe(2); await reopened.dispose();
  });
  it("omits completed read metadata while retaining exact authored baselines", async () => {
    const adapter = memoryAdapter(), controller = createDraftCheckpointController({ scopeKey: "scope", adapter });
    const value = input("unsaved");
    controller.schedule(value); await controller.flush();
    expect(adapter.records.get("scope")).toMatchObject({ saved: value.saved, current: value.current, window: value.window, descriptors: [] });
    await controller.dispose();
  });
  it("surfaces quota failures and retains the newest draft for retry", async () => {
    const adapter = memoryAdapter(), events: unknown[] = [], quota = new DOMException("Quota exceeded", "QuotaExceededError"), originalPut = adapter.put;
    adapter.put = async () => { throw quota; };
    const controller = createDraftCheckpointController({ scopeKey: "scope", adapter, onStatus: event => events.push(event) }); controller.schedule(input("keep me"));
    await expect(controller.flush()).rejects.toBe(quota); expect(events).toContainEqual({ status: "failed", sequence: 1, error: quota });
    adapter.put = originalPut; await controller.flush(); expect(adapter.records.get("scope")?.current.blocks.blocks[0].content).toEqual([{ type: "text", text: "keep me" }]); await controller.dispose();
  });
  it("scope keys isolate origins, accounts, workspaces and documents", () => {
    const base = { origin: "https://orbis.example", userId: "user", workspaceId: "space", noteId: "note" }, original = draftScopeKey(base);
    for (const field of Object.keys(base) as Array<keyof typeof base>) expect(draftScopeKey({ ...base, [field]: base[field] + "other" })).not.toBe(original);
    expect(draftScopeKey({ ...base, userId: "a|b", workspaceId: "c" })).not.toBe(draftScopeKey({ ...base, userId: "a", workspaceId: "b|c" }));
  });
});

it("preserves legacy drafts for export while refusing unsafe cursor or pending intent recovery",()=>{
  const checkpoint:DraftCheckpoint={...input("retained text"),scopeKey:"scope",sequence:1};
  expect(checkpointRecoveryIssue(checkpoint,"note")).toBeNull();
  const legacy=structuredClone(checkpoint) as unknown as Record<string,unknown>;
  legacy.window={noteId:"note",version:1,next:32,total:10000,hasMore:true};
  expect(checkpointRecoveryIssue(legacy as unknown as DraftCheckpoint,"note")).toContain("旧版读取位置");
  expect((legacy.current as DraftCheckpoint["current"]).blocks).toEqual(checkpoint.current.blocks);
  expect(checkpointRecoveryIssue({...checkpoint,pending:{format_version:99} as unknown as NonNullable<DraftCheckpoint["pending"]>},"note")).toContain("待确认保存");
});
