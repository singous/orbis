import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiRequest } from "./api-client";

describe("api client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches bearer tokens to JSON requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
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
        new Response(JSON.stringify({ detail: "Note version conflict" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(apiRequest("/v1/notes/note-id/content")).rejects.toMatchObject({
      status: 409,
      detail: "Note version conflict",
      isConflict: true,
    } satisfies Partial<ApiError>);
  });

  it("notifies callers when authentication expires", async () => {
    const onUnauthorized = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Not authenticated" }), {
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
});
