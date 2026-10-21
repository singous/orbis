import { apiRequest } from "../api/api-client";
import { authTokensSchema, userSchema, pageDataSchema, workspaceSchema, type AuthResponse, type User, type Workspace } from "../api/schemas";
import { authRequestOptions, type AuthRequestOptions } from "./use-auth-request";
export type LoginPayload = { email: string; password: string };
export type SetupPayload = LoginPayload & { display_name: string };
export async function login(payload: LoginPayload): Promise<AuthResponse> {
  const tokens = authTokensSchema.parse(await apiRequest("/v1/auth/login", { method: "POST", body: payload }));
  let workspace: Workspace | null = null;
  for (let page = 1; page <= 100; page += 1) {
    const spaces = pageDataSchema(workspaceSchema).parse(await apiRequest(`/v1/workspaces?page=${page}&page_size=100`, { token: tokens.access_token }));
    workspace ??= spaces.items[0] ?? null;
    const preferred = spaces.items.find(item => item.id === tokens.user.preferred_workspace_id);
    if (preferred) { workspace = preferred; break; }
    if (!spaces.pagination.has_next || !tokens.user.preferred_workspace_id) break;
    if (page === 100) throw new Error("工作空间列表过大，请重试。");
  }
  return { ...tokens, workspace };
}
export async function setup(payload: SetupPayload): Promise<AuthResponse> {
  await apiRequest("/v1/setup", { method: "POST", body: { ...payload, workspace_name: "我的工作空间" } });
  return login({ email: payload.email, password: payload.password });
}
export async function getCurrentUser(token: string): Promise<User> {
  return userSchema.parse(await apiRequest("/v1/me", { token }));
}
export async function logout(auth: AuthRequestOptions): Promise<void> {
  await apiRequest("/v1/auth/logout", { ...authRequestOptions(auth), method: "POST" });
}
