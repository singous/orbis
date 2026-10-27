import {
  createDraftCheckpointController,
  readDraftCandidates,
  resolveDraftLane,
  withDraftLane,
  type CheckpointStatus,
  type DraftCheckpoint,
  type DraftCheckpointSource,
} from "./draft-checkpoints";

/** A physical draft lane is claimed lazily after React commits the session. */
export function createOwnedDraftCheckpoints(options: {
  scopeKey: string;
  onStatus: (status: CheckpointStatus) => void;
  onCandidates: (records: DraftCheckpoint[]) => void;
}) {
  const initialization = new AbortController();
  let controller: ReturnType<typeof createDraftCheckpointController> | null = null;
  let lane: Awaited<ReturnType<typeof resolveDraftLane>> | null = null;
  let ready: Promise<ReturnType<typeof createDraftCheckpointController>> | null = null;
  let disposed = false;
  function initialize() {
    if (disposed) return Promise.reject(new DOMException("The draft session changed", "AbortError"));
    ready ??= resolveDraftLane(options.scopeKey, { signal: initialization.signal }).then(claim => {
      lane = claim;
      controller = createDraftCheckpointController({ scopeKey: withDraftLane(options.scopeKey, claim.laneId), onStatus: options.onStatus });
      return controller;
    });
    return ready;
  }
  return {
    async read() {
      const owned = await initialize();
      const current = await owned.read();
      if (!current && !disposed) {
        const candidates = await readDraftCandidates(options.scopeKey).catch(() => []);
        if (!disposed) options.onCandidates(candidates);
      }
      return current;
    },
    schedule(source: DraftCheckpointSource) {
      if (!controller || disposed) throw new Error("本机草稿会话尚未准备好。");
      return controller.schedule(source);
    },
    async checkpoint(source?: DraftCheckpointSource) { return (await initialize()).checkpoint(source); },
    async startFresh() {
      const previous = await initialize();
      await previous.flush();
      // 保留旧记录，后续写入使用新通道，避免覆盖无法自动恢复的内容。
      const claim = await resolveDraftLane(options.scopeKey, {
        signal: initialization.signal,
        storage: { getItem: () => null, setItem: (key, value) => globalThis.sessionStorage?.setItem(key, value) },
      });
      if (disposed) { claim.release(); throw new DOMException("The draft session changed", "AbortError"); }
      try { await previous.dispose(); }
      catch (error) { claim.release(); throw error; }
      if (disposed) { claim.release(); throw new DOMException("The draft session changed", "AbortError"); }
      lane?.release();
      lane = claim;
      controller = createDraftCheckpointController({ scopeKey: withDraftLane(options.scopeKey, claim.laneId), onStatus: options.onStatus });
      ready = Promise.resolve(controller);
    },
    async acknowledge(sequence: number) { return (await initialize()).acknowledge(sequence); },
    async flush() { if (ready) return (await ready).flush(); },
    async dispose() {
      disposed = true;
      if (!controller) initialization.abort();
      const owned = ready ? await ready.catch(() => null) : null;
      try { if (owned) await owned.dispose(); }
      finally { lane?.release(); initialization.abort(); }
    },
    get sequence() { return controller?.sequence ?? 0; },
    get physicalScopeKey() { return lane ? withDraftLane(options.scopeKey, lane.laneId) : null; },
  };
}
