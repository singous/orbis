import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CheckpointStatus } from "./draft-checkpoints";
import { useDraftCheckpoints } from "./use-draft-checkpoints";

const callbacks = vi.hoisted(() => [] as Array<(event: CheckpointStatus) => void>);
vi.mock("./owned-draft-checkpoints", () => ({ createOwnedDraftCheckpoints: (options: { onStatus: (event: CheckpointStatus) => void }) => {
  callbacks.push(options.onStatus);
  return { dispose: async () => {}, read: async () => null, checkpoint: async () => {}, get sequence() { return 0; } };
} }));
afterEach(() => { cleanup(); callbacks.length = 0; });

it("renders state transitions while exposing the latest sequence without per-key commits", () => {
  let renders = 0;
  const hook = renderHook(() => { renders += 1; return useDraftCheckpoints("scope"); });
  act(() => callbacks[0]({ status: "pending", sequence: 1 }));
  const afterTransition = renders;
  for (let sequence = 2; sequence <= 36; sequence += 1) act(() => callbacks[0]({ status: "pending", sequence }));
  expect(hook.result.current.status).toEqual({ status: "pending", sequence: 36 });
  expect(renders).toBe(afterTransition);
  act(() => callbacks[0]({ status: "saved", sequence: 36 }));
  expect(hook.result.current.status.status).toBe("saved");
  expect(renders).toBeGreaterThan(afterTransition);
});

it("shows new storage errors and ignores callbacks after the document scope changes", () => {
  let renders = 0;
  const hook = renderHook(({ scope }) => { renders += 1; return useDraftCheckpoints(scope); }, { initialProps: { scope: "old" } });
  const failure = new Error("quota");
  act(() => callbacks[0]({ status: "failed", sequence: 1, error: failure }));
  expect(hook.result.current.status.error).toBe(failure);
  const afterFailure = renders;
  const differentFailure = new Error("blocked");
  act(() => callbacks[0]({ status: "failed", sequence: 2, error: differentFailure }));
  expect(hook.result.current.status.error).toBe(differentFailure);
  expect(renders).toBeGreaterThan(afterFailure);
  const beforeClear = renders;
  act(() => callbacks[0]({ status: "cleared", sequence: 2 }));
  expect(hook.result.current.status).toEqual({ status: "cleared", sequence: 2 });
  expect(renders).toBeGreaterThan(beforeClear);
  hook.rerender({ scope: "new" });
  act(() => callbacks[0]({ status: "saved", sequence: 2 }));
  expect(hook.result.current.status).toEqual({ status: "cleared", sequence: 0 });
  act(() => callbacks[1]({ status: "pending", sequence: 1 }));
  expect(hook.result.current.status).toEqual({ status: "pending", sequence: 1 });
});
