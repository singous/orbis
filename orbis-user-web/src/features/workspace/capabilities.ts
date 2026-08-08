import type { Workspace } from "../../shared/api/schemas";

const contentMutationRoles = new Set<Workspace["role"]>([
  "owner",
  "admin",
  "editor",
]);

export function canMutateWorkspaceContent(
  workspace: Workspace | null | undefined,
): boolean {
  return workspace !== null && workspace !== undefined && contentMutationRoles.has(workspace.role);
}

export function canManageWorkspaceMembers(
  workspace: Workspace | null | undefined,
): boolean {
  return workspace?.role === "owner" || workspace?.role === "admin";
}
