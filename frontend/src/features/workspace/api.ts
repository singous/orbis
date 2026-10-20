import { apiRequest } from "../../shared/api/api-client";
import { pageDataSchema, userSchema, workspaceSchema, type Workspace } from "../../shared/api/schemas";
import { authRequestOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";

export async function listWorkspaces(auth: AuthRequestOptions, signal?: AbortSignal) {
  const items: Workspace[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = pageDataSchema(workspaceSchema).parse(await apiRequest(`/v1/workspaces?page=${page}&page_size=100`, { ...authRequestOptions(auth), signal }));
    items.push(...result.items);
    if (!result.pagination.has_next) return { items };
  }
  throw new Error("工作空间数量超过当前选择器的加载上限，请缩小范围。");
}
export async function switchWorkspace(workspaceId: string, auth: AuthRequestOptions, signal?: AbortSignal) {
  const choices = await listWorkspaces(auth, signal);
  const workspace = choices.items.find(item => item.id === workspaceId);
  if (!workspace) throw new Error("所选工作空间已不可用，请重新选择。");
  const user = userSchema.parse(await apiRequest("/v1/me/workspace-preference", {
    ...authRequestOptions(auth), signal, method: "PUT", body: { workspace_id: workspaceId },
  }));
  return { user, workspace };
}
