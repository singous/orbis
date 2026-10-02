import { z } from "zod";
import { searchTypeSchema, type SearchFilters, type SearchResult } from "./api";

export const SEARCH_DEBOUNCE_MS = 250;
export const SEARCH_MAX_LENGTH = 240;
export const SEARCH_TYPE_OPTIONS = [
  { value: "all", label: "全部内容" }, { value: "document", label: "文档与评论" },
  { value: "notebook", label: "笔记本" }, { value: "group", label: "文档分组" },
  { value: "site", label: "站点" }, { value: "file", label: "文件与附件" },
];
export const SEARCH_TYPE_LABELS = { document: "文档", notebook: "笔记本", group: "文档分组", site: "站点", file: "文件" };

export function readSearchFilters(params: URLSearchParams): SearchFilters {
  const parsedType = searchTypeSchema.safeParse(params.get("type"));
  const selectedWorkspace = z.string().uuid().safeParse(params.get("workspace_id"));
  const status = params.get("status");
  const rawPage = Number(params.get("page") ?? 1);
  return {
    q: (params.get("q") ?? "").slice(0, SEARCH_MAX_LENGTH),
    range: selectedWorkspace.success ? selectedWorkspace.data : params.get("scope") === "all" ? "all" : "current",
    type: parsedType.success ? parsedType.data : "all",
    status: status === "archived" || status === "all" ? status : "active",
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

export function writeSearchFilters(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.type !== "all") params.set("type", filters.type);
  if (filters.status !== "active") params.set("status", filters.status);
  if (filters.range === "all") params.set("scope", "all");
  else if (filters.range !== "current") params.set("workspace_id", filters.range);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

export function resultDestination(result: Pick<SearchResult, "type" | "id" | "status" | "matched_comment_id">): string {
  if (result.status === "archived") return `/documents/archive?resource=${result.id}&type=${result.type}`;
  switch (result.type) {
    case "document": return `/documents/${result.id}${result.matched_comment_id ? `?comment=${result.matched_comment_id}` : ""}`;
    case "notebook": return `/collections/${result.id}`;
    case "group": return `/documents/collections?group=${result.id}`;
    case "site": return `/sites/${result.id}`;
    case "file": return `/search/open?type=file&id=${result.id}`;
  }
}

export function resultHref(result: SearchResult, currentWorkspaceId?: string): string {
  if (result.type !== "file" && result.workspace_id === currentWorkspaceId) return resultDestination(result);
  const params = new URLSearchParams({ type: result.type, id: result.id, workspace_id: result.workspace_id, status: result.status });
  if (result.matched_comment_id) params.set("comment", result.matched_comment_id);
  if (result.type === "file") params.set("name", result.title);
  return `/search/open?${params}`;
}
