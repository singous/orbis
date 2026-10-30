import { transferableAbortController } from "node:util";

const NativeRequest = globalThis.Request;

/** Bridge jsdom signals into the native Request realm while preserving cancellation. */
export class BrowserRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const signal = init?.signal;
    if (!signal) {
      super(input, init);
      return;
    }
    const controller = transferableAbortController();
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    super(input, { ...init, signal: controller.signal });
  }
}
