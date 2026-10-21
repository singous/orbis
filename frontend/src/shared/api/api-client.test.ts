import { afterEach, describe, expect, it, vi } from "vitest";
import { apiBlobRequest, apiRequest } from "./api-client";
function response(status: number, data: unknown, code = status < 400 ? "OK" : "AUTH_REQUIRED") {
  return new Response(JSON.stringify({ code, message: "测试响应", request_id: "request", data }), { status, headers: { "Content-Type": "application/json" } });
}
afterEach(() => vi.unstubAllGlobals());
describe("native API transport", () => {
  it("keeps workspace scope in the explicit path and serializes JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(201, { id: "created" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest("/v1/workspaces/workspace-a/collections", { method: "POST", token: "access", workspaceId: "workspace-b", body: { title: "文集" } })).resolves.toEqual({ id: "created" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/workspaces/workspace-a/collections");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer access");
    expect(new Headers(init.headers).has("X-Workspace-ID")).toBe(false);
    expect(init.body).toBe(JSON.stringify({ title: "文集" }));
    expect(init.redirect).toBe("error");
  });
  it("rejects invalid success envelopes and preserves typed conflicts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("<html>proxy</html>")).mockResolvedValueOnce(response(409, { current_version: 3 }, "DOCUMENT_VERSION_CONFLICT")));
    await expect(apiRequest("/v1/me")).rejects.toMatchObject({ code: "API_RESPONSE_INVALID" });
    await expect(apiRequest("/v1/me")).rejects.toMatchObject({ status: 409, code: "DOCUMENT_VERSION_CONFLICT", requestId: "request", data: { current_version: 3 }, isConflict: true });
  });
  it("persists both rotated credentials and retries the original resource", async () => {
    const refreshed = vi.fn(), unauthorized = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce(response(401, null)).mockResolvedValueOnce(response(200, { access_token: "new-access", refresh_token: "new-refresh" })).mockResolvedValueOnce(response(200, { items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest("/v1/workspaces/space-a/collections", { token: "expired", refreshToken: "rotation-a", onTokenRefresh: refreshed, onUnauthorized: unauthorized })).resolves.toEqual({ items: [] });
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/v1/workspaces/space-a/collections", "/api/v1/auth/refresh", "/api/v1/workspaces/space-a/collections"]);
    expect(new Headers(fetchMock.mock.calls[2][1].headers).get("Authorization")).toBe("Bearer new-access");
    expect(refreshed).toHaveBeenCalledWith("new-access", "new-refresh");
    expect(unauthorized).not.toHaveBeenCalled();
  });
  it("shares one rotation between concurrent401 responses and a delayed reader", async () => {
    let rotations = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/auth/refresh")) { rotations += 1; await new Promise(resolve => setTimeout(resolve, 10)); return response(200, { access_token: "shared-access", refresh_token: "shared-refresh" }); }
      return new Headers(init.headers).get("Authorization") === "Bearer shared-access" ? response(200, { ok: true }) : response(401, null);
    });
    vi.stubGlobal("fetch", fetchMock);
    const options = { token: "old", refreshToken: "concurrent-original", onTokenRefresh: vi.fn() };
    await Promise.all([apiRequest("/v1/me", options), apiRequest("/v1/workspaces", options)]);
    await apiRequest("/v1/me", options);
    expect(rotations).toBe(1);
    expect(options.onTokenRefresh).toHaveBeenCalledTimes(3);
  });
  it("keeps credentials after transient refresh failure and permits a later retry", async () => {
    const unauthorized = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce(response(401, null)).mockResolvedValueOnce(response(503, null, "SERVICE_UNAVAILABLE")).mockResolvedValueOnce(response(401, null)).mockResolvedValueOnce(response(200, { access_token: "access-retry", refresh_token: "refresh-retry" })).mockResolvedValueOnce(response(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    const options = { token: "old", refreshToken: "transient-original", onUnauthorized: unauthorized };
    await expect(apiRequest("/v1/me", options)).rejects.toMatchObject({ status: 503 });
    await apiRequest("/v1/me", options);
    expect(unauthorized).not.toHaveBeenCalled();
  });
  it("retains a completed rotation when its initiating read was canceled", async () => {
    const controller = new AbortController(), refreshed = vi.fn();
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn().mockResolvedValueOnce(response(401, null)).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; controller.abort(); }));
    vi.stubGlobal("fetch", fetchMock);
    const result = apiRequest("/v1/me", { token: "old", refreshToken: "cancel-original", signal: controller.signal, onTokenRefresh: refreshed });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    finish(response(200, { access_token: "access-after-cancel", refresh_token: "refresh-after-cancel" }));
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(refreshed).toHaveBeenCalledWith("access-after-cancel", "refresh-after-cancel");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("reads binary responses through the same envelope error boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("bytes", { headers: { "Content-Type": "image/png" } })).mockResolvedValueOnce(response(404, null, "RESOURCE_NOT_FOUND")));
    expect((await apiBlobRequest("/v1/me/avatar")).size).toBe(5);
    await expect(apiBlobRequest("/v1/me/avatar")).rejects.toMatchObject({ status: 404 });
  });
});
