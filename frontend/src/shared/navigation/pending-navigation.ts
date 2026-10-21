type NavigationPreparation = () => Promise<void>;

const preparations = new Map<symbol, NavigationPreparation>();
let generation = 0;

/** Participants belong to mounted editors; unregistering invalidates pending opens. */
export function registerPendingNavigation(prepare: NavigationPreparation): () => void {
  const key = Symbol("navigation-preparation");
  preparations.set(key, prepare);
  generation += 1;
  return () => { if (preparations.delete(key)) generation += 1; };
}

/** Flush only on committed same-tab navigation, never when a palette opens/closes.
 * Cancellation prevents the later transition, without aborting an active save. */
export async function preparePendingNavigation(signal?: AbortSignal): Promise<void> {
  const currentGeneration = generation;
  const currentPreparations = [...preparations.values()];
  function assertCurrent() {
    if (signal?.aborted || generation !== currentGeneration) {
      throw new DOMException("Navigation preparation cancelled", "AbortError");
    }
  }
  assertCurrent();
  for (const prepare of currentPreparations) {
    assertCurrent();
    try { await prepare(); }
    catch (error) { assertCurrent(); throw error; }
    assertCurrent();
  }
}
