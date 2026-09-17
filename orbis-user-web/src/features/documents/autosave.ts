export type AutosaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

type AutosaveOptions<T> = {
  delayMs: number;
  /**
   * Minimum time between two saves. Bursts separated by short pauses coalesce
   * into one save — keeps full-document saves from scaling with keystroke
   * rhythm on long documents.
   */
  minIntervalMs?: number;
  /**
   * Maximum time a draft may stay dirty without a save attempt, even while
   * the user keeps typing — bounds the crash data-loss window.
   */
  maxDelayMs?: number;
  fingerprint: (value: T) => string;
  save: (current: T, saved: T) => Promise<T>;
  onStateChange?: (state: AutosaveState) => void;
};

function isConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 409;
}

export class AutosaveCoordinator<T> {
  readonly #delayMs: number;
  readonly #minIntervalMs: number;
  readonly #maxDelayMs: number | null;
  readonly #fingerprint: (value: T) => string;
  readonly #save: (current: T, saved: T) => Promise<T>;
  readonly #onStateChange?: (state: AutosaveState) => void;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #inFlight: Promise<void> | null = null;
  #current: T | null = null;
  #saved: T | null = null;
  #state: AutosaveState = "saved";
  #dirtySince: number | null = null;
  #lastFlushAt = Number.NEGATIVE_INFINITY;

  constructor(options: AutosaveOptions<T>) {
    this.#delayMs = options.delayMs;
    this.#minIntervalMs = options.minIntervalMs ?? 0;
    this.#maxDelayMs = options.maxDelayMs ?? null;
    this.#fingerprint = options.fingerprint;
    this.#save = options.save;
    this.#onStateChange = options.onStateChange;
  }

  get state(): AutosaveState {
    return this.#state;
  }

  get current(): T | null {
    return this.#current;
  }

  get saved(): T | null {
    return this.#saved;
  }

  hydrate(value: T): void {
    this.#clearTimer();
    this.#current = value;
    this.#saved = value;
    this.#dirtySince = null;
    this.#setState("saved");
  }

  change(value: T): void {
    this.#current = value;
    if (this.#saved && this.#fingerprint(value) === this.#fingerprint(this.#saved)) {
      this.#clearTimer();
      this.#dirtySince = null;
      this.#setState("saved");
      return;
    }
    this.#dirtySince ??= Date.now();
    this.#setState("dirty");
    this.#schedule();
  }

  async flush(): Promise<void> {
    this.#clearTimer();
    if (this.#inFlight) {
      await this.#inFlight;
    }
    const current = this.#current;
    const saved = this.#saved;
    if (!current || !saved || this.#fingerprint(current) === this.#fingerprint(saved)) {
      this.#dirtySince = null;
      this.#setState("saved");
      return;
    }

    this.#lastFlushAt = Date.now();
    this.#dirtySince = null;
    this.#setState("saving");
    const savingFingerprint = this.#fingerprint(current);
    this.#inFlight = this.#save(current, saved)
      .then((nextSaved) => {
        this.#saved = nextSaved;
        if (this.#current && this.#fingerprint(this.#current) !== this.#fingerprint(nextSaved)) {
          this.#dirtySince ??= Date.now();
          this.#setState("dirty");
          this.#schedule();
        } else {
          if (this.#current && this.#fingerprint(this.#current) === savingFingerprint) {
            this.#current = nextSaved;
          }
          this.#setState("saved");
        }
      })
      .catch((error: unknown) => {
        this.#dirtySince ??= Date.now();
        this.#setState(isConflict(error) ? "conflict" : "error");
      })
      .finally(() => {
        this.#inFlight = null;
      });
    await this.#inFlight;
  }

  async retry(): Promise<void> {
    await this.flush();
  }

  dispose(flush = false): void {
    this.#clearTimer();
    if (flush) {
      void this.flush();
    }
  }

  #schedule(): void {
    this.#clearTimer();
    const now = Date.now();
    // Quiet period coalesces keystrokes; the min interval rate-limits
    // back-to-back saves; the max delay caps the crash-loss window.
    const quietAt = now + this.#delayMs;
    const intervalAt = this.#lastFlushAt + this.#minIntervalMs;
    const maxAt =
      this.#maxDelayMs != null && this.#dirtySince != null
        ? this.#dirtySince + this.#maxDelayMs
        : Number.POSITIVE_INFINITY;
    const fireAt = Math.min(Math.max(quietAt, intervalAt), maxAt);
    this.#timer = setTimeout(() => {
      void this.flush();
    }, Math.max(0, fireAt - now));
  }

  #clearTimer(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #setState(state: AutosaveState): void {
    this.#state = state;
    this.#onStateChange?.(state);
  }
}
