import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const now = Date.parse("2026-11-01T00:00:00Z");
const userId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
const user = { id: userId, email: "owner@example.com", display_name: "测试成员", bio: null, avatar_asset_id: null, preferred_workspace_id: workspaceId, profile_version: 1, created_at_ms: now - 86_400_000, updated_at_ms: 1 };
const workspace = { id: workspaceId, name: "首页测试空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 };
const resource = { workspace_id: workspaceId, is_archived: false, archived_at_ms: null, created_at_ms: now, updated_at_ms: now };
const notebooks = [3, 4, 5].map((value, index) => ({ ...resource, id: `00000000-0000-4000-8000-00000000000${value}`, group_id: "00000000-0000-4000-8000-000000000009", title: ["读书札记", "生活碎片", "产品手记"][index], sort_order: index, icon: null, metadata_version: 1, directory_version: 1 }));
const notes = [6, 7, 8].map((value, index) => ({ ...resource, id: `00000000-0000-4000-8000-00000000000${value}`, collection_id: notebooks[index].id, parent_id: null, position: index, title: ["周末计划", "零散的想法", "首页的小灵感"][index], content_version: 1, summary: "文档摘要" }));
const tag = { id: "00000000-0000-4000-8000-000000000010", name: "设计", version: 1, count: 0, created_at_ms: 1, updated_at_ms: 1 };
const pageData = (items: unknown[]) => ({ items, pagination: { page: 1, page_size: 20, total: items.length } });

test.beforeEach(async ({ page }) => {
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
});

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) {
  test(`home ${theme} at ${width}px keeps panel and editor layout`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/home");
    await expect(page.locator(".home-document-row")).toHaveCount(3);
    const composer = page.getByRole("region", { name: "快速记录" });
    await composer.getByRole("textbox", { name: "随手记正文" }).fill("Home layout draft");
    await composer.locator("summary").click();
    await composer.locator(".quick-note-tag-options").getByRole("button", { name: "设计", exact: true }).click();
    await composer.locator("summary").click();
    const panels = await page.locator(".home-grid > .home-card").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
    expect(panels).toHaveLength(4);
    if (width === 1280) {
      expect(panels[0].y).toBe(panels[1].y);
      expect(panels[0].height).toBe(panels[1].height);
      expect(panels[1].x - panels[0].right).toBeCloseTo(16, 1);
      expect(panels[2].y).toBe(panels[3].y);
    } else for (let index = 1; index < panels.length; index += 1) expect(panels[index].y - panels[index - 1].bottom).toBeCloseTo(16, 1);
    await expect(composer.locator(".tiptap")).toHaveCSS("min-height", "160px");
    await expect(composer.locator(".tiptap")).toHaveCSS("padding", "12px 12px 32px");
    await expect(composer.locator(".quick-note-composer-tags")).toHaveCSS("order", "3");
    await expect(composer.locator(".quick-note-selected-tag")).toContainText("设计");
    expect(await page.locator(".home-page").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (width === 390) await expect(page.locator(".home-welcome-art")).toHaveCSS("width", "128px");
    expect((await new AxeBuilder({ page }).include(".home-page").analyze()).violations).toEqual([]);
  });
}

test("home chrome preserves a local draft, tags, attachment entry and keyboard save", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/home");
  const composer = page.getByRole("region", { name: "快速记录" });
  const editor = composer.getByRole("textbox", { name: "随手记正文" });
  await editor.fill("保留这条首页灵感");
  await composer.locator("summary").click();
  await composer.locator(".quick-note-tag-options").getByRole("button", { name: "设计", exact: true }).click();
  await composer.locator("summary").click();
  await page.reload();
  await expect(editor).toContainText("保留这条首页灵感");
  await expect(composer.locator(".quick-note-selected-tag")).toContainText("设计");
  const chooser = page.waitForEvent("filechooser");
  await composer.getByRole("button", { name: "添加附件", exact: true }).click();
  await (await chooser).setFiles([]);
  const saving = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/quick-notes"));
  await editor.focus();
  await page.keyboard.press("Control+Enter");
  const body = (await saving).postDataJSON();
  expect(body).toMatchObject({ expected_version: 0, tag_ids: [tag.id], operation_id: expect.any(String) });
  expect(JSON.stringify(body.blocks)).toContain("保留这条首页灵感");
  await expect(editor).toHaveText("");
  await expect(composer.getByText("已记下", { exact: true })).toBeVisible();
});

test("home startup uses the shared responsive panel geometry", async ({ page }) => {
  let releaseModule!: () => void;
  const loading = new Promise<void>(resolve => { releaseModule = resolve; });
  await page.route("**/src/features/home/HomePage.tsx*", async route => { await loading; await route.continue(); });
  const opening = page.goto("/home");
  try {
    const home = page.locator(".workspace-loading-home");
    await expect(home).toBeVisible();
    await expect(home.locator(".home-grid > .home-card")).toHaveCount(4);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await home.locator(".home-grid").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(width === 1280 ? 2 : 1);
      expect(await home.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  } finally { releaseModule(); }
  await opening;
  await expect(page.locator(".home-document-row")).toHaveCount(3);
});

test.describe("home touch scale", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("keeps search and editor dimensions tied to the shared user font scale", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/home");
    await expect(page.locator(".home-document-row")).toHaveCount(3);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.fontSize = "20px"; });
    const search = page.getByRole("searchbox", { name: "搜索文档" });
    await expect(search).toHaveCSS("height", "55px");
    await expect(search).toHaveCSS("font-size", "20px");
    const trigger = page.getByRole("search").getByRole("button", { name: "搜索", exact: true });
    await expect(trigger).toHaveCSS("height", "55px");
    await expect(trigger).toHaveCSS("width", "55px");
    await expect(page.locator(".home-note-field .tiptap")).toHaveCSS("min-height", "220px");
    expect(await page.locator(".home-page").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
});
