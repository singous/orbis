import { Worker } from "node:worker_threads";
import { EngineError, MAX_WORKERS, TRANSFORM_TIMEOUT_MS, type ErrorCode } from "./protocol";
import type { TransformRequest, TransformResult } from "./engine";

type Slot = { worker: Worker; busy: boolean; retirement?: Promise<void>; reject?: (error: unknown) => void };
type WorkerFactory = (url: URL) => Worker;
const createWorker: WorkerFactory = url => new Worker(url, { resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } });

export class EnginePool {
  private readonly slots: Slot[] = [];
  private readonly retiring = new Set<Promise<void>>();
  private closed = false;
  private closePromise?: Promise<void>;
  constructor(private timeoutMs = TRANSFORM_TIMEOUT_MS, size = MAX_WORKERS, private workerURL = new URL("./worker.mjs", import.meta.url), private workerFactory: WorkerFactory = createWorker) {
    if (!Number.isInteger(size) || size < 1 || size > MAX_WORKERS) throw new Error("Invalid collaboration worker count");
    for (let index = 0; index < size; index++) this.slots.push(this.create());
  }
  private create(): Slot {
    const slot: Slot = { worker: this.workerFactory(this.workerURL), busy: false };
    const crashed = () => {
      if (slot.retirement || this.closed) return;
      if (slot.reject) slot.reject(new EngineError("ENGINE_FAILURE"));
      else void this.retire(slot);
    };
    slot.worker.on("error", crashed);
    slot.worker.on("exit", crashed);
    return slot;
  }
  private retire(slot: Slot): Promise<void> {
    if (slot.retirement) return slot.retirement;
    slot.busy = true;
    // Keep the slot unavailable until the owned thread has actually exited.
    // Replacing it sooner can double live workers during repeated deadlines.
    const stopped = slot.worker.terminate().then(() => {
      const index = this.slots.indexOf(slot);
      if (!this.closed && index !== -1) this.slots[index] = this.create();
    });
    slot.retirement = stopped;
    this.retiring.add(stopped);
    void stopped.then(() => this.retiring.delete(stopped), () => this.retiring.delete(stopped));
    return stopped;
  }
  run(request: TransformRequest): Promise<TransformResult> {
    const slot = this.slots.find(slot => !slot.busy && !slot.retirement);
    if (this.closed || !slot) return Promise.reject(new EngineError("ENGINE_BUSY"));
    slot.busy = true;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error?: unknown, result?: TransformResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        slot.worker.off("message", message);
        slot.reject = undefined;
        if (!slot.retirement) slot.busy = false;
        if (error) reject(error); else resolve(result!);
      };
      const abort = (error: unknown) => {
        if (finished) return;
        void this.retire(slot);
        finish(error);
      };
      const message = (response: { result?: TransformResult; code?: ErrorCode }) => {
        if (response.code) finish(new EngineError(response.code)); else finish(undefined, response.result);
      };
      const timer = setTimeout(() => abort(new EngineError("ENGINE_TIMEOUT")), this.timeoutMs);
      slot.reject = abort;
      slot.worker.on("message", message);
      try { slot.worker.postMessage(request); }
      catch { abort(new EngineError("ENGINE_FAILURE")); }
    });
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    for (const slot of this.slots) slot.reject?.(new EngineError("ENGINE_FAILURE"));
    const owned = this.slots.map(slot => this.retire(slot));
    this.closePromise = Promise.all([...owned, ...this.retiring]).then(() => {});
    return this.closePromise;
  }
}
