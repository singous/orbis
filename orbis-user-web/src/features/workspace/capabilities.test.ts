import { describe, expect, it } from "vitest";

import type { Workspace } from "../../shared/api/schemas";
import { canManageWorkspaceMembers, canMutateWorkspaceContent } from "./capabilities";

const workspace = {
  id: "018ff7c4-a5b6-7000-8000-000000000001",
  name: "Orbis Workspace",
  workspace_type: "team",
  role: "owner",
  is_current: true,
  created_at_ms: 1,
  updated_at_ms: 1,
} satisfies Workspace;

describe("workspace capabilities", () => {
  it.each(["owner", "admin", "editor"] as const)("permits %s to mutate workspace content", (role) => {
    expect(canMutateWorkspaceContent({ ...workspace, role })).toBe(true);
  });

  it("denies content mutations without an active writable workspace", () => {
    expect(canMutateWorkspaceContent(null)).toBe(false);
    expect(canMutateWorkspaceContent({ ...workspace, role: "normal" })).toBe(false);
  });

  it("limits member administration to owners and administrators", () => {
    expect(canManageWorkspaceMembers({ ...workspace, role: "owner" })).toBe(true);
    expect(canManageWorkspaceMembers({ ...workspace, role: "admin" })).toBe(true);
    expect(canManageWorkspaceMembers({ ...workspace, role: "editor" })).toBe(false);
    expect(canManageWorkspaceMembers(null)).toBe(false);
  });
});
