import type { Workspace } from "../../shared/api/schemas";

const contentMutationRoles = new Set<Workspace["role"]>([
  "owner",
  "admin",
  "editor",
]);

export const WORKSPACE_ROLE_LABELS: Record<Workspace["role"], string> = {
  owner: "所有者",
  admin: "管理员",
  editor: "编辑者",
  normal: "成员",
};

export function workspaceRoleLabel(
  role: Workspace["role"] | null | undefined,
): string {
  return (role && WORKSPACE_ROLE_LABELS[role]) || "成员";
}

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
