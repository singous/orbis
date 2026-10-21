import { afterEach, expect, it, vi } from "vitest";
import { preparePendingNavigation, registerPendingNavigation } from "./pending-navigation";

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); });
function register(prepare: () => Promise<void>) {
  const dispose = registerPendingNavigation(prepare);
  cleanup.push(dispose);
  return dispose;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { resolve, promise };
}

it("does not prepare merely when a participant registers, and propagates actual save failures", async () => {
  const first = vi.fn().mockRejectedValue(new Error("Keep draft"));
  const second = vi.fn().mockResolvedValue(undefined);
  register(first); register(second);
  expect(first).not.toHaveBeenCalled();
  await expect(preparePendingNavigation()).rejects.toThrow("Keep draft");
  expect(second).not.toHaveBeenCalled();
});

it("waits for the mounted participant before permitting navigation", async () => {
  const save = deferred();
  register(() => save.promise);
  const navigate = vi.fn();
  const pending = preparePendingNavigation().then(navigate);
  await Promise.resolve();
  expect(navigate).not.toHaveBeenCalled();
  save.resolve();
  await pending;
  expect(navigate).toHaveBeenCalledOnce();
});

it("cancels a late transition on palette dismissal while allowing the save to finish", async () => {
  const save = deferred();
  const saved = vi.fn();
  register(async () => { await save.promise; saved(); });
  const controller = new AbortController();
  const navigate = vi.fn();
  const pending = preparePendingNavigation(controller.signal).then(navigate);
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  save.resolve();
  await rejected;
  expect(saved).toHaveBeenCalledOnce();
  expect(navigate).not.toHaveBeenCalled();
});

it("does not reuse a successful old participant after a source unmount and remount", async () => {
  const save = deferred();
  const dispose = register(() => save.promise);
  const pending = preparePendingNavigation();
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  dispose();
  const current = vi.fn().mockResolvedValue(undefined);
  register(current);
  save.resolve();
  await rejected;
  expect(current).not.toHaveBeenCalled();
  await preparePendingNavigation();
  expect(current).toHaveBeenCalledOnce();
});

it("ignores removed participants and an already cancelled selection", async () => {
  const prepare = vi.fn().mockResolvedValue(undefined);
  const dispose = register(prepare);
  dispose(); dispose();
  await preparePendingNavigation();
  expect(prepare).not.toHaveBeenCalled();
  register(prepare);
  const controller = new AbortController(); controller.abort();
  await expect(preparePendingNavigation(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(prepare).not.toHaveBeenCalled();
});
