import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DraftCheckpoint } from "./draft-checkpoints";
import { useDraftCheckpoints } from "./use-draft-checkpoints";

const state = vi.hoisted(() => ({ sequence: 0, record: null as unknown }));
vi.mock("./owned-draft-checkpoints", () => ({ createOwnedDraftCheckpoints: (options: { scopeKey: string }) => ({
  read: async () => state.record,
  checkpoint: async (input: Record<string, unknown>) => { state.sequence += 1; state.record = { ...input, scopeKey: options.scopeKey + "|owned", sequence: state.sequence }; },
  acknowledge: async (sequence: number) => { const record = state.record as { sequence: number } | null; if (record && record.sequence <= sequence) state.record = null; },
  dispose: async () => {},
  get sequence() { return state.sequence; },
}) }));
afterEach(() => { cleanup(); state.sequence = 0; state.record = null; });

it("adopts the owned checkpoint sequence before acknowledging a recovered foreign lane", async () => {
  const draft = { title: "Local", version: 2, blocks: { schema_version: 2 as const, editor: "blocknote" as const, blocks: [{ id: "p", type: "paragraph", props: {}, content: [{ type: "text" as const, text: "body" }], children: [] }] } };
  const foreign: DraftCheckpoint = { scopeKey: "another-lane", sequence: 100, saved: draft, current: draft, window: null, descriptors: [] };
  const hook = renderHook(() => useDraftCheckpoints("scope"));
  await act(async () => { await hook.result.current.chooseRecovery(foreign); });
  expect(hook.result.current.recovery?.sequence).toBe(1);
  expect(hook.result.current.recovery?.scopeKey).toBe("scope|owned");
  await act(async () => { await hook.result.current.controller.checkpoint({ saved: draft, current: { ...draft, title: "new edit" }, window: null, descriptors: [] }); });
  await act(async () => { await hook.result.current.controller.acknowledge(hook.result.current.recovery!.sequence); });
  expect(state.record).toMatchObject({ sequence: 2, current: { title: "new edit" } });
});
