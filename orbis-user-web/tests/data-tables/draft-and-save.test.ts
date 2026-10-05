import { describe, expect, it, vi } from "vitest";
import {
  afterAcknowledgement,
  combineChanges,
} from "../../src/features/data-tables/drafts";
import { AutosaveCoordinator } from "../../src/features/documents/autosave";
import { tableId } from "../../src/features/data-tables/model";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("table changes and document coordination", () => {
  it("keeps edits made while an older cell request is in flight", () => {
    const before = {
      upserts: [{ id: "row", values: { title: "first", status: "todo" } }],
    };
    const current = combineChanges(before, {
      upserts: [{ id: "row", values: { title: "newer", due: 1000 } }],
    });
    expect(afterAcknowledgement(current, before)).toEqual({
      upserts: [{ id: "row", values: { title: "newer", due: 1000 } }],
      deletes: [],
    });
  });
  it("does not resurrect a row deleted after its cell save began", () => {
    const sent = { upserts: [{ id: "row", values: { title: "first" } }] };
    const current = combineChanges(sent, { deletes: ["row"] });
    expect(afterAcknowledgement(current, sent)).toEqual({
      upserts: [],
      deletes: ["row"],
    });
  });
  it("serializes two table saves and rebases intervening typing without overwriting it", async () => {
    type Draft = { body: string; table: number; version: number };
    const saves: number[] = [],
      external: number[] = [],
      hold = gate(),
      started = gate();
    const coordinator = new AutosaveCoordinator<Draft>({
      delayMs: 100000,
      fingerprint: (value) => JSON.stringify([value.body, value.table]),
      save: async (current, saved) => {
        saves.push(saved.version);
        return { ...current, version: saved.version + 1 };
      },
    });
    coordinator.hydrate({ body: "base", table: 0, version: 1 });
    coordinator.change({ body: "before table", table: 0, version: 1 });
    const first = coordinator.externalChange(async (saved) => {
      external.push(saved.version);
      started.resolve();
      await hold.promise;
      return {
        result: 1,
        transform: (value: Draft) => ({
          ...value,
          table: 1,
          version: saved.version + 1,
        }),
      };
    });
    await started.promise;
    coordinator.change({ body: "typed during request", table: 0, version: 1 });
    const second = coordinator.externalChange(async (saved) => {
      external.push(saved.version);
      return {
        result: 2,
        transform: (value: Draft) => ({
          ...value,
          table: 2,
          version: saved.version + 1,
        }),
      };
    });
    hold.resolve();
    await Promise.all([first, second]);
    expect(saves).toEqual([1, 3]);
    expect(external).toEqual([2, 4]);
    expect(coordinator.current).toEqual({
      body: "typed during request",
      table: 2,
      version: 5,
    });
    expect(coordinator.state).toBe("saved");
    coordinator.dispose();
  });
  it("retains a conflict and local typing when an external mutation fails", async () => {
    const coordinator = new AutosaveCoordinator({
      delayMs: 100000,
      fingerprint: (value: { text: string }) => value.text,
      save: vi.fn(),
    });
    coordinator.hydrate({ text: "old" });
    await expect(
      coordinator.externalChange(async () => {
        coordinator.change({ text: "new" });
        throw Object.assign(new Error("Conflict"), { status: 409 });
      }),
    ).rejects.toThrow("Conflict");
    expect(coordinator.state).toBe("conflict");
    expect(coordinator.current).toEqual({ text: "new" });
    coordinator.dispose();
  });
  it("creates UUIDv7 identities without requiring a secure browser context", () => {
    expect(tableId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
