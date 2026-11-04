import type { Page } from "@playwright/test";

export const now = Date.parse("2026-11-01T00:00:00Z");
const userId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
export const user = { id: userId, email: "owner@example.com", display_name: "测试成员", bio: null, avatar_asset_id: null, preferred_workspace_id: workspaceId, profile_version: 1, created_at_ms: now - 86_400_000, updated_at_ms: 1 };
export const workspace = { id: workspaceId, name: "首页测试空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 };
const resource = { workspace_id: workspaceId, is_archived: false, archived_at_ms: null, created_at_ms: now, updated_at_ms: now };
export const notebooks = [3, 4, 5].map((value, index) => ({ ...resource, id: `00000000-0000-4000-8000-00000000000${value}`, group_id: "00000000-0000-4000-8000-000000000009", title: ["读书札记", "生活碎片", "产品手记"][index], sort_order: index, icon: null, metadata_version: 1, directory_version: 1 }));
export const notes = [6, 7, 8].map((value, index) => ({ ...resource, id: `00000000-0000-4000-8000-00000000000${value}`, collection_id: notebooks[index].id, parent_id: null, position: index, title: ["周末计划", "零散的想法", "首页的小灵感"][index], content_version: 1, summary: "文档摘要" }));
export const tag = { id: "00000000-0000-4000-8000-000000000010", name: "设计", version: 1, count: 0, created_at_ms: 1, updated_at_ms: 1 };
const pageData = (items: unknown[]) => ({ items, pagination: { page: 1, page_size: 20, total: items.length } });

export async function installHomeFixture(page: Page) {
  await page.addInitScript(({ user, workspace, now }) => {
    Date.now = () => now;
    localStorage.setItem("orbis.auth.v2", JSON.stringify({ user, workspace, accessToken: "home-test", refreshToken: "home-refresh", credentialID: "home-session" }));
  }, { user, workspace, now });
  const savedNotes: unknown[] = [];
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = pageData([]);
    if (url.pathname.endsWith("/collections")) data = pageData(notebooks);
    else if (url.pathname.endsWith("/documents")) data = pageData(notes);
    else if (url.pathname.endsWith("/quick-notes/summary")) data = { total: savedNotes.length, untagged: 0, deleted: 0 };
    else if (url.pathname.endsWith("/quick-note-tags")) data = pageData([tag]);
    else if (url.pathname.endsWith("/quick-notes")) {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        data = { ...body, id: "00000000-0000-4000-8000-000000000011", workspace_id: workspaceId, owner_id: userId, version: 1, is_pinned: false, created_at_ms: now, updated_at_ms: now, deleted_at_ms: null };
        savedNotes.push(data);
      } else data = pageData(savedNotes);
    } else if (url.pathname === "/api/v1/me") data = user;
    await route.fulfill({ json: { code: "OK", message: "", request_id: "home-ui", data } });
  });
}
