import { expect, it } from "vitest";
import { BrowserRequest } from "./browser-request";

it("forwards a DOM AbortSignal cancellation into the native router Request", () => {
  const controller = new AbortController();
  const request = new BrowserRequest("https://orbis.example/sites", { signal: controller.signal });
  expect(request.signal.aborted).toBe(false);
  controller.abort("navigation cancelled");
  expect(request.signal.aborted).toBe(true);
  expect(request.signal.reason).toBe("navigation cancelled");
});

it("preserves an already-aborted router request", () => {
  const controller = new AbortController();
  controller.abort("already cancelled");
  const request = new BrowserRequest("https://orbis.example/sites", { signal: controller.signal });
  expect(request.signal.aborted).toBe(true);
  expect(request.signal.reason).toBe("already cancelled");
});
