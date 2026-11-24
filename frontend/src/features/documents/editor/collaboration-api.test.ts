import { afterEach, expect, it, vi } from "vitest";
import { getDocumentCollaboration, openDocumentCollaboration } from "./collaboration-api";

const id = "00000000-0000-4000-8000-000000000001";
const auth = { accessToken: "synthetic-token", refreshToken: null, workspaceId: id, onTokenRefresh: () => {}, onUnauthorized: () => {} };
const state = { document_id: id, epoch: id, protocol_version: 1, content_version: 1, state: null, updates: null, updated_at_ms: 1 };
const response = (data: unknown, code = "OK", status = 200) => new Response(JSON.stringify({ code, data, request_id: "test", message: "测试" }), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("reads a binary snapshot without encoding its Yjs bytes as text", async () => {
  const metadata = new TextEncoder().encode(JSON.stringify(state));
  const bytes = new Uint8Array(4 + metadata.length + 3);
  new DataView(bytes.buffer).setUint32(0, metadata.length);
  bytes.set(metadata, 4);
  bytes.set([0, 128, 255], 4 + metadata.length);
  const fetch = vi.fn().mockResolvedValue(new Response(bytes, {
    headers: { "Content-Type": "application/vnd.orbis.yjs" },
  }));
  vi.stubGlobal("fetch", fetch);
  const result = await getDocumentCollaboration(id, auth);
  expect(result.state).toEqual(new Uint8Array([0, 128, 255]));
  expect(result.epoch).toBe(id);
  expect(new Headers(fetch.mock.calls[0][1].headers).get("Accept")).toBe("application/vnd.orbis.yjs, application/json");
});

it("applies a resume response only to a matching confirmed base", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ ...state, content_version: 2, updates: ["Ag=="] }));
  vi.stubGlobal("fetch", fetch);
  const cached = { ...state, protocol_version: 1 as const, state: "AQ==", updates: undefined };
  const result = await openDocumentCollaboration(id, auth, true, new AbortController().signal, cached);
  expect(result).toMatchObject({ state: "AQ==", updates: ["Ag=="], content_version: 2 });
  expect(fetch.mock.calls[0][0]).toContain(`epoch=${id}&after_version=1`);
  expect(fetch.mock.calls[0][1].method).toBe("POST");
});

it("falls back to a full snapshot when the cached epoch cannot be resumed", async () => {
  const epoch = "00000000-0000-4000-8000-000000000002";
  const fetch = vi.fn().mockResolvedValueOnce(response({ ...state, epoch })).mockResolvedValueOnce(response({ ...state, epoch, state: "Ag==" }));
  vi.stubGlobal("fetch", fetch);
  const cached = { ...state, protocol_version: 1 as const, state: "AQ==", updates: undefined };
  await expect(openDocumentCollaboration(id, auth, false, new AbortController().signal, cached)).resolves.toMatchObject({ state: "Ag==", epoch });
  expect(fetch.mock.calls[1][0]).toMatch(/\/collaboration$/);
});

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
