import { afterEach, describe, expect, it, vi } from "vitest";

import { createNotebook, updateNotebook, type AuthRequestOptions } from "../../src/features/documents/api";
import { getNotebookIcon } from "../../src/features/documents/notebook-icon-api";
import { notebookSchema } from "../../src/shared/api/schemas";

const fileId = "018ff7c4-a5b6-7000-8000-000000000040";
const notebook = {
  id: "018ff7c4-a5b6-7000-8000-000000000001", tenant_id: null,
  workspace_id: "018ff7c4-a5b6-7000-8000-000000000002", owner_id: "018ff7c4-a5b6-7000-8000-000000000003",
  group_id: "018ff7c4-a5b6-7000-8000-000000000004", title: "Notebook", sort_order: 0, status: "active",
  created_at_ms: 1, updated_at_ms: 2,
};
const auth: AuthRequestOptions = { accessToken: "expired", refreshToken: "refresh", onTokenRefresh: vi.fn(), onUnauthorized: vi.fn() };

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ code: "OK", message: "success", request_id: "icon-test", data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("notebook icon API", () => {
  it("keeps old notebook records valid and preserves both supported icon representations", () => {
    expect(notebookSchema.parse(notebook).icon).toBeUndefined();
    expect(notebookSchema.parse({ ...notebook, icon: null }).icon).toBeNull();
    const preset = { type: "preset", name: "code", color: "mint" };
    expect(notebookSchema.parse({ ...notebook, icon: preset }).icon).toEqual(preset);
    const image = { type: "image", file_id: fileId };
    expect(notebookSchema.parse({ ...notebook, icon: image }).icon).toEqual(image);
    expect(notebookSchema.safeParse({ ...notebook, icon: { type: "image", file_id: "https://untrusted/image.png" } }).success).toBe(false);
  });

  it("sends persistent icons on create and an explicit null on reset", async () => {
    const icon = { type: "preset" as const, name: "palette" as const, color: "rose" as const };
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ ...notebook, icon })).mockResolvedValueOnce(envelope({ ...notebook, icon: null }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await createNotebook({ title: notebook.title, sort_order: 0, icon }, auth)).icon).toEqual(icon);
    expect((await updateNotebook(notebook.id, { icon: null }, auth)).icon).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).icon).toEqual(icon);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).icon).toBeNull();
  });

  it("uses token refresh for authenticated custom image reads", async () => {
    const data = { data_url: "data:image/webp;base64,aWNvbg==" };
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope(null, 401)).mockResolvedValueOnce(envelope({ access_token: "renewed" })).mockResolvedValueOnce(envelope(data));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getNotebookIcon(fileId, auth)).toEqual(data);
    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/notebooks/icons/${fileId}`, expect.objectContaining({ headers: { Authorization: "Bearer renewed" } }));
    expect(auth.onTokenRefresh).toHaveBeenCalledWith("renewed");
    expect(auth.onUnauthorized).not.toHaveBeenCalled();
  });
});
