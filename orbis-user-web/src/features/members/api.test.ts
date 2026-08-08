import { beforeEach, describe, expect, it, vi } from "vitest";

import { listInvitations, listMembers, type MemberAuth } from "./api";

const auth: MemberAuth = {
  accessToken: "access-token",
  refreshToken: null,
  onTokenRefresh: vi.fn(),
  onUnauthorized: vi.fn(),
};

function envelope(data: unknown) {
  return new Response(JSON.stringify({
    code: "OK",
    message: "请求成功",
    request_id: "018ff7c4-a5b6-7000-8000-000000000010",
    data,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const pagination = {
  page: 1,
  page_size: 100,
  total: 0,
  total_pages: 0,
  has_next: false,
  has_previous: false,
};

describe("member API", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the shared pagination contract for members and invitations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(envelope({ items: [], pagination }))
      .mockResolvedValueOnce(envelope({ items: [], pagination }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listMembers(auth)).resolves.toEqual({ items: [], pagination });
    await expect(listInvitations(auth)).resolves.toEqual({ items: [], pagination });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/workspace/members?page=1&page_size=100",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/workspace/invitations?page=1&page_size=100",
      expect.any(Object),
    );
  });
});
