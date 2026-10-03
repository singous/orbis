import { z } from "zod";
import { apiRequest } from "../../shared/api/api-client";
import { paginationSchema } from "../../shared/api/schemas";
import { authRequestOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";

export const searchTypeSchema = z.enum(["document", "notebook", "group", "site", "file"]);
export type SearchType = z.infer<typeof searchTypeSchema>;
export type SearchFilters = { q: string; type: SearchType | "all"; status: "active" | "archived" | "all"; page: number };
export const SEARCH_PAGE_SIZE = 20;

export const searchResultSchema = z.object({
  id: z.string().uuid(), type: searchTypeSchema, workspace_id: z.string().uuid(), workspace_name: z.string(),
  title: z.string(), location: z.string(), snippet: z.string(), match: z.enum(["title", "body", "comment", "metadata"]),
  matched_comment_id: z.string().uuid().nullable(), status: z.enum(["active", "archived"]), updated_at_ms: z.number(),
  notebook_id: z.string().uuid().nullable(), group_id: z.string().uuid().nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
export const searchResponseSchema = z.object({
  items: z.array(searchResultSchema), pagination: paginationSchema,
});

export function searchRequestPath(filters: SearchFilters): string {
  const params = new URLSearchParams({ q: filters.q.trim(), type: filters.type, status: filters.status, page: String(filters.page), page_size: String(SEARCH_PAGE_SIZE) });
  return `/search?${params}`;
}

export async function searchWorkspace(filters: SearchFilters, auth: AuthRequestOptions, signal?: AbortSignal) {
  return searchResponseSchema.parse(await apiRequest(searchRequestPath(filters), { ...authRequestOptions(auth), signal }));
}

export async function lookupSearchResource(type: SearchType, id: string, status: "active" | "archived", auth: AuthRequestOptions, signal?: AbortSignal) {
  const params = new URLSearchParams({ type, resource_id: id, status });
  const result = searchResponseSchema.parse(await apiRequest(`/search?${params}`, { ...authRequestOptions(auth), signal }));
  return result.items[0] ?? null;
}
