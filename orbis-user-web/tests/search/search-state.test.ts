import { describe, expect, it } from "vitest";
import { searchRequestPath, type SearchResult } from "../../src/features/search/api";
import { readSearchFilters, resultHref, writeSearchFilters } from "../../src/features/search/search-state";

const id = "018ff7c4-a5b6-7000-8000-000000000001";
const workspace = "018ff7c4-a5b6-7000-8000-000000000002";

describe("global search state", () => {
  it("keeps scope explicit and resets invalid URL values to supported defaults", () => {
    expect(readSearchFilters(new URLSearchParams("scope=all&type=memory&status=invalid&page=-2"))).toEqual({ q: "", range: "all", type: "all", status: "active", page: 1 });
    const filters = { q: "  设计 规范  ", range: workspace, type: "document" as const, status: "archived" as const, page: 2 };
    expect(readSearchFilters(writeSearchFilters(filters))).toEqual({ ...filters, q: "设计 规范" });
    const request = new URL(searchRequestPath(filters), "http://orbis.test");
    expect(request.searchParams.get("q")).toBe("设计 规范");
    expect(request.searchParams.get("workspace_id")).toBe(workspace);
    expect(request.searchParams.has("scope")).toBe(false);
    expect(request.searchParams.get("page_size")).toBe("20");
  });

  it("opens same-space documents normally and routes other-space and file links through authorization", () => {
    const result = { id, type: "document", status: "active", workspace_id: workspace, matched_comment_id: null } as SearchResult;
    expect(resultHref(result, workspace)).toBe(`/documents/${id}`);
    expect(resultHref({ ...result, matched_comment_id: id }, workspace)).toBe(`/documents/${id}?comment=${id}`);
    expect(resultHref(result, id)).toContain(`/search/open?type=document&id=${id}&workspace_id=${workspace}`);
    expect(resultHref({ ...result, type: "file", title: "报告.pdf" }, workspace)).toContain("/search/open?type=file");
    expect(resultHref({ ...result, status: "archived" }, workspace)).toBe(`/documents/archive?resource=${id}&type=document`);
  });
});
