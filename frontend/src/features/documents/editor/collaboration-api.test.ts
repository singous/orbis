import { afterEach, expect, it, vi } from "vitest";
import { getDocumentCollaboration } from "./collaboration-api";

const id = "00000000-0000-4000-8000-000000000001";
const auth = { accessToken: "synthetic-token", refreshToken: null, workspaceId: id, onTokenRefresh: () => {}, onUnauthorized: () => {} };
const state = { document_id: id, epoch: id, protocol_version: 1, content_version: 1, state: null, updates: null, updated_at_ms: 1 };
const response = (data: unknown, code = "OK", status = 200) => new Response(JSON.stringify({ code, data, request_id: "test", message: "测试" }), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("retries bounded bootstrap contention while retaining activation semantics", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(response(null, "DOCUMENT_OPERATIONS_BUSY", 503)).mockResolvedValue(response(state));
  vi.stubGlobal("fetch", fetch);
  const pending = getDocumentCollaboration(id, auth, { activate: true });
  const resolved = expect(pending).resolves.toMatchObject({ content_version: 1, state: undefined, updates: undefined });
  await vi.advanceTimersByTimeAsync(150);
  await resolved;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.map(call => call[1].method)).toEqual(["POST", "POST"]);
});

it("cancels bootstrap backoff when the document is switched", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue(response(null, "DOCUMENT_OPERATIONS_BUSY", 503));
  vi.stubGlobal("fetch", fetch);
  const abort = new AbortController();
  const pending = getDocumentCollaboration(id, auth, { activate: true, signal: abort.signal });
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0); abort.abort();
  await rejected;
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(1);
});
