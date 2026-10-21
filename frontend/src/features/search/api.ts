import { z } from "zod";
import { ApiError,apiRequest,workspacePath } from "../../shared/api/api-client";
import { paginationSchema } from "../../shared/api/schemas";
import { authRequestOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";

export const searchTypeSchema = z.enum(["document", "notebook", "group", "site", "file"]);
export type SearchType = z.infer<typeof searchTypeSchema>;
export type SearchFilters = { q: string; type: SearchType | "all"; status: "active" | "archived" | "all"; page: number };
export const SEARCH_PAGE_SIZE = 20;

export const searchResultSchema = z.object({
  id:z.string().uuid(),type:z.enum(["document","collection","group","site","file"]),workspace_id:z.string().uuid(),
  title:z.string(),location:z.string(),snippet:z.string(),match:z.enum(["title","body","comment","metadata"]),
  matched_comment_id:z.string().uuid().nullable(),status:z.enum(["active","archived"]),updated_at_ms:z.number().int(),
  collection_id:z.string().uuid().nullable(),group_id:z.string().uuid().nullable(),
}).transform(value=>({...value,type:value.type==="collection" ? "notebook" as const : value.type,notebook_id:value.collection_id}));
export type SearchResult = z.infer<typeof searchResultSchema>;
export const searchResponseSchema = z.object({
  items: z.array(searchResultSchema), pagination: paginationSchema,
});

export function searchRequestPath(filters: SearchFilters,auth:Pick<AuthRequestOptions,"workspaceId">): string {
  const params = new URLSearchParams({ q: filters.q.trim(), type: filters.type==="notebook" ? "collection" : filters.type, status: filters.status, page: String(filters.page), page_size: String(SEARCH_PAGE_SIZE) });
  return workspacePath(auth,`/search?${params}`);
}

export async function searchWorkspace(filters: SearchFilters, auth: AuthRequestOptions, signal?: AbortSignal) {
  const result=searchResponseSchema.parse(await apiRequest(searchRequestPath(filters,auth), { ...authRequestOptions(auth), signal }));
  if(result.items.some(item=>item.workspace_id!==auth.workspaceId))throw new ApiError(502,"搜索响应的工作空间不一致。","API_RESPONSE_INVALID");
  return result;
}

export async function lookupSearchResource(type: SearchType, id: string, status: "active" | "archived", auth: AuthRequestOptions, signal?: AbortSignal) {
  const params = new URLSearchParams({ type:type==="notebook" ? "collection" : type, resource_id: id, status });
  const result = searchResponseSchema.parse(await apiRequest(workspacePath(auth,`/search?${params}`), { ...authRequestOptions(auth), signal }));
  if(result.items.some(item=>item.workspace_id!==auth.workspaceId))throw new ApiError(502,"搜索响应的工作空间不一致。","API_RESPONSE_INVALID");
  return result.items[0] ?? null;
}
