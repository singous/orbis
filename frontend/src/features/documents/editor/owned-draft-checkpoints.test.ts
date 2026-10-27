import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { createOwnedDraftCheckpoints } from "./owned-draft-checkpoints";
import { createIndexedDbDraftAdapter, type DraftCheckpointInput } from "./draft-checkpoints";

function draft(title: string): DraftCheckpointInput {
  const saved = { title: "服务器版本", version: 1, blocks: { schema_version: 2 as const, editor: "blocknote" as const, blocks: [] } };
  return { saved, current: { ...saved, title }, window: null, descriptors: [] };
}

it("retains the previous draft when opening a fresh editing lane", async () => {
  const controller = createOwnedDraftCheckpoints({ scopeKey: crypto.randomUUID(), onStatus: vi.fn(), onCandidates: vi.fn() });
  const adapter = createIndexedDbDraftAdapter();
  try {
    await controller.read();
    await controller.checkpoint(draft("仍需保留的旧内容"));
    const previousKey = controller.physicalScopeKey!;
    const previous = await adapter.read(previousKey);
    await controller.startFresh();
    expect(controller.physicalScopeKey).not.toBe(previousKey);
    expect(await controller.read()).toBeNull();
    await controller.checkpoint(draft("继续编辑的新内容"));
    expect(await adapter.read(previousKey)).toEqual(previous);
    expect((await controller.read())?.current.title).toBe("继续编辑的新内容");
  } finally { await controller.dispose(); }
});

it("does not claim a new lane after the owning view is disposed", async () => {
  const controller = createOwnedDraftCheckpoints({ scopeKey: crypto.randomUUID(), onStatus: vi.fn(), onCandidates: vi.fn() });
  await controller.read();
  await controller.checkpoint(draft("保留"));
  await controller.dispose();
  await expect(controller.startFresh()).rejects.toMatchObject({ name: "AbortError" });
});
