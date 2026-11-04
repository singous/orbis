import type { Page } from "@playwright/test";
import type { User, Workspace } from "../../../src/shared/api/schemas";

export const user: User = { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com", display_name: "原名称", bio: "原简介", avatar_asset_id: null, preferred_workspace_id: null, profile_version: 3, created_at_ms: 1, updated_at_ms: 1 };
export const workspace: Workspace = { id: "00000000-0000-4000-8000-000000000002", name: "测试空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 };
export async function installSession(page: Page) {
  await page.addInitScript(({ user, workspace }) => {
    localStorage.setItem("orbis.auth.v2", JSON.stringify({ user, workspace, accessToken: "test-token", refreshToken: "test-refresh", credentialID: "test-session" }));
  }, { user, workspace });
}
export const pagination = { page: 1, page_size: 20, total: 0 };
