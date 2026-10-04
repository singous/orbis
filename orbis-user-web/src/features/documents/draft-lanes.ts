/** Draft lanes are tab-local recovery streams. Native Web Locks establish
 * ownership; a BroadcastChannel timeout alone never proves another tab dead. */
export type DraftLaneClaim = {
  laneId: string;
  previousLaneId: string | null;
  collided: boolean;
  ownership: "confirmed" | "unavailable";
  release(): void;
};
type LaneMessage = { kind: "probe" | "occupied" | "claim"; laneId: string; instanceId: string };
export type DraftLaneChannel = Pick<BroadcastChannel, "postMessage" | "addEventListener" | "removeEventListener" | "close">;
export type DraftLaneOptions = {
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  locks?: Pick<LockManager, "request"> | null;
  createChannel?: ((name: string) => DraftLaneChannel) | null;
  randomId?: () => string;
  settleMs?: number;
  signal?: AbortSignal;
};
const LANE_STORAGE_PREFIX = "orbis.draft-lane:";
const CLAIM_WINDOW_MS = 80;

export function draftLanePrefix(scopeKey: string): string { return `${scopeKey.length}:${scopeKey}|lane:`; }
export function withDraftLane(scopeKey: string, laneId: string): string { return draftLanePrefix(scopeKey) + laneId; }
function randomId(): string { const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes); return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join(""); }
function sessionStorageOrNull(): Pick<Storage, "getItem" | "setItem"> | null { try { return globalThis.sessionStorage ?? null; } catch { return null; } }
function isLane(value: string | null): value is string { return !!value && /^[A-Za-z0-9_-]{8,128}$/.test(value); }

async function exclusiveClaim(locks: Pick<LockManager, "request">, name: string): Promise<(() => void) | null> {
  return new Promise((resolve, reject) => {
    void locks.request(name, { ifAvailable: true, mode: "exclusive" }, async lock => {
      if (!lock) { resolve(null); return; }
      await new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}

export async function resolveDraftLane(scopeKey: string, options: DraftLaneOptions = {}): Promise<DraftLaneClaim> {
  if (options.signal?.aborted) throw new DOMException("Draft lane claim aborted", "AbortError");
  const storage = options.storage === undefined ? sessionStorageOrNull() : options.storage;
  const locks = options.locks === undefined ? globalThis.navigator?.locks ?? null : options.locks;
  const createChannel = options.createChannel === undefined ? typeof globalThis.BroadcastChannel === "function" ? (name: string) => new BroadcastChannel(name) : null : options.createChannel;
  const id = options.randomId ?? randomId;
  const storageKey = LANE_STORAGE_PREFIX + scopeKey;
  let previous: string | null = null;
  try { const value = storage?.getItem(storageKey) ?? null; if (isLane(value)) previous = value; } catch { /* Storage failure must not cause two tabs to share a lane. */ }
  let laneId = previous ?? id(), unlock: (() => void) | null = null, collided = false;
  if (locks) {
    try {
      unlock = await exclusiveClaim(locks, withDraftLane(scopeKey, laneId));
      if (!unlock) {
        collided = true;
        for (let attempt = 0; attempt < 3 && !unlock; attempt++) { laneId = id(); unlock = await exclusiveClaim(locks, withDraftLane(scopeKey, laneId)); }
      }
    } catch { unlock = null; }
  }
  if (!unlock) {
    // Without an atomic ownership primitive, never reuse a possibly cloned
    // physical lane. Keep the prior record available for explicit recovery.
    laneId = id();
  }
  const instanceId = id();
  let channel: DraftLaneChannel | null = null, occupied = false, owned = false;
  const listener = (event: Event) => {
    const message = (event as MessageEvent<Partial<LaneMessage>>).data;
    if (!message || message.instanceId === instanceId) return;
    if (!unlock && previous && message.laneId === previous && (message.kind === "occupied" || message.kind === "claim")) { collided = true; return; }
    if (message.laneId !== laneId) return;
    if (message.kind === "probe" && owned) channel?.postMessage({ kind: "occupied", laneId, instanceId } satisfies LaneMessage);
    else if (message.kind === "occupied" || message.kind === "claim") occupied = true;
  };
  try {
    channel = createChannel?.("orbis-draft-ownership:" + scopeKey) ?? null;
    channel?.addEventListener("message", listener);
    channel?.postMessage({ kind: "probe", laneId, instanceId } satisfies LaneMessage);
    // Probe the old candidate too. This distinguishes a duplicated/popup
    // sessionStorage from an ordinary reload even in the conservative fallback.
    if (!unlock && previous) channel?.postMessage({ kind: "probe", laneId: previous, instanceId } satisfies LaneMessage);
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException("Draft lane claim aborted", "AbortError")); };
      const timer = setTimeout(() => { options.signal?.removeEventListener("abort", abort); resolve(); }, options.settleMs ?? CLAIM_WINDOW_MS);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
    if (occupied) {
      // A fallback client may not participate in Web Locks. Never override it.
      unlock?.(); unlock = null; collided = true; laneId = id();
    }
    try { storage?.setItem(storageKey, laneId); } catch { /* A fresh lane remains safe, recovery selection remains available. */ }
    owned = true;
    channel?.postMessage({ kind: "claim", laneId, instanceId } satisfies LaneMessage);
    let released = false;
    const release = () => { if (released) return; released = true; owned = false; channel?.removeEventListener("message", listener); channel?.close(); unlock?.(); options.signal?.removeEventListener("abort", release); };
    options.signal?.addEventListener("abort", release, { once: true });
    return { laneId, previousLaneId: previous, collided, ownership: unlock ? "confirmed" : "unavailable", release };
  } catch (error) { channel?.removeEventListener("message", listener); channel?.close(); unlock?.(); throw error; }
}
