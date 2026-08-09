import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutosaveCoordinator, type AutosaveState } from "./autosave";

type Draft = { title: string; version: number };

describe("AutosaveCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces changes, saves the latest draft, and skips unchanged content", async () => {
    const save = vi.fn(async (draft: Draft) => ({ ...draft, version: draft.version + 1 }));
    const states: AutosaveState[] = [];
    const autosave = new AutosaveCoordinator<Draft>({
      delayMs: 750,
      fingerprint: (draft) => draft.title,
      save,
      onStateChange: (state) => states.push(state),
    });

    autosave.hydrate({ title: "Draft", version: 1 });
    autosave.change({ title: "Draft v2", version: 1 });
    autosave.change({ title: "Draft v3", version: 1 });

    await vi.advanceTimersByTimeAsync(749);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      { title: "Draft v3", version: 1 },
      { title: "Draft", version: 1 },
    );
    expect(states).toContain("dirty");
    expect(states).toContain("saving");
    expect(autosave.state).toBe("saved");

    autosave.change({ title: "Draft v3", version: 2 });
    await vi.advanceTimersByTimeAsync(750);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps the local draft after a conflict and retries it explicitly", async () => {
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    const save = vi
      .fn<(draft: Draft, saved: Draft) => Promise<Draft>>()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ title: "Local edit", version: 3 });
    const autosave = new AutosaveCoordinator<Draft>({
      delayMs: 750,
      fingerprint: (draft) => draft.title,
      save,
    });

    autosave.hydrate({ title: "Server", version: 2 });
    autosave.change({ title: "Local edit", version: 2 });
    await vi.advanceTimersByTimeAsync(750);

    expect(autosave.state).toBe("conflict");
    expect(autosave.current).toEqual({ title: "Local edit", version: 2 });

    await autosave.retry();
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosave.state).toBe("saved");
  });
});
