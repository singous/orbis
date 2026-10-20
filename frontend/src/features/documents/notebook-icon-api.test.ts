import { afterEach, describe, expect, it, vi } from "vitest";

import { createNotebook, updateNotebook, type AuthRequestOptions } from "./api";
import { getNotebookIcon } from "./notebook-icon-api";
import { notebookSchema } from "../../shared/api/schemas";

const fileId = "018ff7c4-a5b6-7000-8000-000000000040";
const notebook = {
  id: "018ff7c4-a5b6-7000-8000-000000000001", tenant_id: null,
  workspace_id: "018ff7c4-a5b6-7000-8000-000000000002", owner_id: "018ff7c4-a5b6-7000-8000-000000000003",
  group_id: "018ff7c4-a5b6-7000-8000-000000000004", title: "Notebook", sort_order: 0, is_archived:false,archived_at_ms:null,metadata_version:3,directory_version:1,icon:null,
  created_at_ms: 1, updated_at_ms: 2,
};
const auth: AuthRequestOptions = { workspaceId:notebook.workspace_id,accessToken: "expired", refreshToken: "refresh", onTokenRefresh: vi.fn(), onUnauthorized: vi.fn() };

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ code: "OK", message: "success", request_id: "icon-test", data }), {
    status, headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("notebook icon API", () => {
  it("parses explicit native icon nullability and preserves both supported icon representations", () => {
    expect(notebookSchema.parse(notebook).icon).toBeNull();
    expect(notebookSchema.parse({ ...notebook, icon: null }).icon).toBeNull();
    const preset = { type: "preset", name: "code", color: "mint" };
    expect(notebookSchema.parse({ ...notebook, icon: preset }).icon).toEqual(preset);
    const image = { type: "image", asset_id: fileId };
    expect(notebookSchema.parse({ ...notebook, icon: image }).icon).toEqual(image);
    expect(notebookSchema.safeParse({ ...notebook, icon: { type: "image", asset_id: "https://untrusted/image.png" } }).success).toBe(false);
  });

  it("sends persistent icons on create and an explicit null on reset", async () => {
    const icon = { type: "preset" as const, name: "palette" as const, color: "rose" as const };
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ ...notebook, icon })).mockResolvedValueOnce(envelope({ ...notebook, icon: null }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await createNotebook({ title: notebook.title, sort_order: 0, icon }, auth)).icon).toEqual(icon);
    expect((await updateNotebook(notebook.id, { icon: null,expected_version:3 }, auth)).icon).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).icon).toEqual(icon);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).icon).toBeNull();
  });

  it("uses token refresh for authenticated custom image reads", async () => {
    const data = { data_url: "data:image/png;base64,aWNvbg==" };
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope(null, 401)).mockResolvedValueOnce(envelope({ access_token: "renewed",refresh_token:"renewed-icon-refresh" })).mockResolvedValueOnce(new Response("icon",{headers:{"Content-Type":"image/png"}}));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getNotebookIcon(fileId, auth)).toEqual(data);
    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/v1/workspaces/${notebook.workspace_id}/assets/${fileId}/content`, expect.objectContaining({ headers: { authorization: "Bearer renewed" } }));
    expect(auth.onTokenRefresh).toHaveBeenCalledWith("renewed","renewed-icon-refresh");
    expect(auth.onUnauthorized).not.toHaveBeenCalled();
  });
});
