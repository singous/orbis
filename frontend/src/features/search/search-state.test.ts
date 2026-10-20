import { describe, expect, it } from "vitest";
import { searchRequestPath, type SearchResult } from "./api";
import { readSearchFilters, resultHref, writeSearchFilters } from "./search-state";

const id = "018ff7c4-a5b6-7000-8000-000000000001";
const workspace = "018ff7c4-a5b6-7000-8000-000000000002";

describe("global search state", () => {
  it("ignores legacy workspace filters and normalizes content filters", () => {
    expect(readSearchFilters(new URLSearchParams("scope=all&type=memory&status=invalid&page=-2"))).toEqual({ q: "", type: "all", status: "active", page: 1 });
    const filters = { q: "  设计 规范  ", type: "document" as const, status: "archived" as const, page: 2 };
    expect(readSearchFilters(writeSearchFilters(filters))).toEqual({ ...filters, q: "设计 规范" });
    const request = new URL(searchRequestPath(filters,{workspaceId:workspace}), "http://orbis.test");
    expect(request.searchParams.get("q")).toBe("设计 规范");
    expect(request.searchParams.has("workspace_id")).toBe(false);
    expect(request.searchParams.has("scope")).toBe(false);
    expect(request.searchParams.get("page_size")).toBe("20");
    expect(readSearchFilters(new URLSearchParams(`q=one&workspace_id=${workspace}&scope=all`))).not.toHaveProperty("range");
  });

  it("keeps resource URLs independent of workspace selection", () => {
    const result = { id, type: "document", status: "active", workspace_id: workspace, matched_comment_id: null } as SearchResult;
    expect(resultHref(result)).toBe(`/documents/${id}`);
    expect(resultHref({ ...result, matched_comment_id: id })).toBe(`/documents/${id}?comment=${id}`);
    expect(resultHref({ ...result, type: "file", title: "报告.pdf" })).toContain("/search/open?type=file");
    expect(resultHref({ ...result, status: "archived" })).toBe(`/documents/archive?resource=${id}&type=document`);
  });
});
