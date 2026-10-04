import { z } from "zod";

import { apiRequest } from "../../shared/api/api-client";
import { userSchema, workspaceSchema } from "../../shared/api/schemas";
import { authRequestOptions, type AuthRequestOptions } from "../../shared/auth/use-auth-request";

const workspaceListSchema = z.object({ items: z.array(workspaceSchema) });
const workspaceSwitchSchema = z.object({ user: userSchema, workspace: workspaceSchema });

/** Global discovery remains available if the previously selected space was revoked. */
export async function listWorkspaces(auth: AuthRequestOptions, signal?: AbortSignal) {
  return workspaceListSchema.parse(await apiRequest("/workspaces", { ...authRequestOptions(auth), workspaceId: null, signal }));
}

/** Only this explicit global action changes the persisted default workspace. */
export async function switchWorkspace(workspaceId: string, auth: AuthRequestOptions, signal?: AbortSignal) {
  return workspaceSwitchSchema.parse(await apiRequest("/workspace/switch", {
    ...authRequestOptions(auth), workspaceId: null, signal, method: "POST", body: { workspace_id: workspaceId },
  }));
}
