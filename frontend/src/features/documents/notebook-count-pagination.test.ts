import { afterEach, expect, it, vi } from "vitest";
import { browseNotes } from "./api";
const id = "018ff7c4-a5b6-7000-8000-000000000001";
const note = { id, tenant_id: null, workspace_id: id, owner_id: id, is_archived:false,archived_at_ms:null,content_version:1, created_at_ms: 1, updated_at_ms: 1, collection_id: id, parent_id: null, position:0, title: "文档", note_type: "document", summary:"内容" };
function response(page: number) {
  return new Response(JSON.stringify({ code: "OK", message: "", request_id: "counts", data: { items: [{ ...note, title: `第 ${page} 页` }], pagination: { page, page_size: 20, total: 21, total_pages: 2, has_next: page === 1, has_previous: page > 1 } } }), { headers: { "Content-Type": "application/json" } });
}
afterEach(() => vi.unstubAllGlobals());
it("collects all pages for notebook counts while keeping normal search paginated", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response(1)).mockResolvedValueOnce(response(2)).mockResolvedValueOnce(response(1));
  vi.stubGlobal("fetch", fetchMock);
  const auth = { workspaceId:id,refreshToken:null,accessToken: "counts-test", onTokenRefresh: vi.fn(), onUnauthorized: vi.fn() };
  const all = await browseNotes(auth, "active", { allPages: true });
  expect(all.items.map((item) => item.title)).toEqual(["第 1 页", "第 2 页"]);
  expect(fetchMock.mock.calls[1][0]).toContain("page=2");
  const search = await browseNotes(auth);
  expect(search.items).toHaveLength(1);
  expect(search.pagination.has_next).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
