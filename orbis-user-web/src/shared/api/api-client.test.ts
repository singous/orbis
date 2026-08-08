import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiRequest } from "./api-client";

describe("api client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches bearer tokens to JSON requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        code: "OK",
        message: "请求成功",
        request_id: "018ff7c4-a5b6-7000-8000-000000000001",
        data: { ok: true },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/v1/notes", {
      method: "POST",
      token: "access-token",
      body: { title: "New note" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/notes",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ title: "New note" }),
      }),
    );
  });

  it("turns backend conflicts into typed api errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          code: "NOTE_VERSION_CONFLICT",
          message: "文档内容版本冲突，请刷新后重试",
          request_id: "018ff7c4-a5b6-7000-8000-000000000002",
          data: { expected_version: 2 },
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(apiRequest("/v1/notes/note-id/content")).rejects.toMatchObject({
      status: 409,
      code: "NOTE_VERSION_CONFLICT",
      message: "文档内容版本冲突，请刷新后重试",
      requestId: "018ff7c4-a5b6-7000-8000-000000000002",
      data: { expected_version: 2 },
      isConflict: true,
    } satisfies Partial<ApiError>);
  });

  it("notifies callers when authentication expires", async () => {
    const onUnauthorized = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          code: "AUTH_REQUIRED",
          message: "请先登录",
          request_id: "018ff7c4-a5b6-7000-8000-000000000003",
          data: null,
        }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(apiRequest("/v1/users/me", { onUnauthorized })).rejects.toMatchObject({
      status: 401,
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("refreshes expired access tokens and retries the original request once", async () => {
    const onTokenRefresh = vi.fn();
    const onUnauthorized = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          code: "AUTH_REQUIRED",
          message: "请先登录",
          request_id: "018ff7c4-a5b6-7000-8000-000000000004",
          data: null,
        }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          code: "OK",
          message: "请求成功",
          request_id: "018ff7c4-a5b6-7000-8000-000000000005",
          data: { access_token: "new-access-token", token_type: "bearer" },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          code: "OK",
          message: "请求成功",
          request_id: "018ff7c4-a5b6-7000-8000-000000000006",
          data: { items: [] },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiRequest("/v1/notes", {
        token: "expired-access-token",
        refreshToken: "refresh-token",
        onTokenRefresh,
        onUnauthorized,
      }),
    ).resolves.toEqual({ items: [] });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/refresh",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ refresh_token: "refresh-token" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/notes",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer new-access-token" }),
      }),
    );
    expect(onTokenRefresh).toHaveBeenCalledWith("new-access-token");
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
