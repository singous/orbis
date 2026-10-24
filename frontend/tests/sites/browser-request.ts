import { transferableAbortController } from "node:util";

const NativeRequest = globalThis.Request;

/** jsdom 的 DOM signal 需要桥接到 Node Request 的原生 realm，仍保留取消语义。 */
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
