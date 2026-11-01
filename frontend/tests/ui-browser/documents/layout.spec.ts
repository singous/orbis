import { Buffer } from "node:buffer";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const now = Date.parse("2026-11-01T00:00:00Z");
const workspace = { id: "00000000-0000-4000-8000-000000000002", name: "文档布局空间", role: "owner", created_at_ms: 1, updated_at_ms: 1 };
const user = { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com", display_name: "布局成员", bio: "测试资料", avatar_asset_id: null, preferred_workspace_id: workspace.id, profile_version: 1, created_at_ms: 1, updated_at_ms: 1 };
const resource = { workspace_id: workspace.id, is_archived: false, archived_at_ms: null, created_at_ms: now, updated_at_ms: now };
const group = { ...resource, id: "00000000-0000-4000-8000-000000000009", name: "项目文档", is_default: true, sort_order: 0, version: 1 };
const notebooks = [3, 4, 5].map((id, index) => ({ ...resource, id: `00000000-0000-4000-8000-00000000000${id}`, group_id: group.id, title: ["产品研发笔记本", "阅读资料", "工作手记"][index], sort_order: index, icon: null, metadata_version: 1, directory_version: 1 }));
const notes = [6, 7, 8].map((id, index) => ({ ...resource, id: `00000000-0000-4000-8000-00000000000${id}`, collection_id: notebooks[0].id, parent_id: index === 1 ? "00000000-0000-4000-8000-000000000006" : null, position: index, title: ["开始使用", "安装与配置", "功能说明"][index], content_version: 1, summary: "布局验证文档" }));
const pageData = (items: unknown[]) => ({ items, pagination: { page: 1, page_size: 100, total: items.length } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ user, workspace, now, pinned }) => {
    Date.now = () => now;
    localStorage.setItem("orbis.auth.v2", JSON.stringify({ user, workspace, accessToken: "layout", refreshToken: "layout-refresh", credentialID: "layout-session" }));
    localStorage.setItem(`orbis.pinnedNotebooks.${workspace.id}`, JSON.stringify([pinned]));
  }, { user, workspace, now, pinned: notebooks[0].id });
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = pageData([]);
    if (path.endsWith("/collection-groups")) data = pageData([group]);
    else if (path.endsWith(`/collections/${notebooks[0].id}/documents`)) data = pageData(notes);
    else if (path.endsWith("/collections")) data = pageData(notebooks);
    else if (path.endsWith("/documents")) data = pageData(notes);
    else if (path.includes("/collections/")) data = notebooks.find(item => path.endsWith(`/${item.id}`));
    else if (path === "/api/v1/me") data = user;
    else if (path === "/api/v1/workspaces") data = pageData([workspace]);
    await route.fulfill({ json: { code: "OK", message: "", request_id: "document-layout", data } });
  });
});

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) {
  test(`document workbench ${theme} at ${width}px keeps layout and navigation`, async ({ page }, info) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/documents");
    const groupRegion = page.getByRole("region", { name: group.name, exact: true });
    await expect(groupRegion.locator(".notebook-overview-card")).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    const overview = await groupRegion.evaluate(element => {
      const grid = element.querySelector(".notebook-overview-grid")!;
      const styles = getComputedStyle(grid);
      return { gap: styles.gap, columns: styles.gridTemplateColumns.split(" ").length, cards: [...element.querySelectorAll(".notebook-overview-card")].map(item => ({ width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height, radius: getComputedStyle(item).borderRadius })) };
    });
    expect(overview.gap).toBe("16px");
    expect(overview.cards.every(card => card.height >= 136 && card.radius === "12px")).toBe(true);
    expect(overview.columns).toBe(width === 390 ? 1 : 3);
    expect((await new AxeBuilder({ page }).include(".notebook-overview").analyze()).violations).toEqual([]);
    const pinned = page.getByRole("region", { name: "常用", exact: true });
    await expect(pinned.locator(".notebook-overview-card")).toHaveCount(1);
    await pinned.getByRole("button", { name: "收起常用区域" }).click();
    await expect(pinned.locator(".notebook-overview-card")).toHaveCount(0);
    await pinned.getByRole("button", { name: "展开常用区域" }).click();
    await pinned.getByRole("link", { name: notebooks[0].title, exact: false }).click();
    const cover = page.getByRole("article", { name: "笔记本首页" });
    await expect(cover).toBeVisible();
    await expect(cover.getByRole("link", { name: "开始使用", exact: true })).toBeVisible();
    const notebook = await cover.evaluate(element => {
      const css = getComputedStyle(element);
      const title = element.querySelector(".page-title")!;
      const header = element.querySelector(".notebook-page-header")!;
      const intro = element.querySelector(".notebook-home-intro")!;
      return { padding: css.padding, radius: css.borderRadius, titleSize: getComputedStyle(title).fontSize, headerMargin: getComputedStyle(header).marginBottom, introMargin: getComputedStyle(intro).marginBottom, rowHeight: element.querySelector(".document-main-row")!.getBoundingClientRect().height };
    });
    expect(notebook.radius).toBe(width === 390 ? "12px" : "16px");
    expect(notebook.titleSize).toBe(width === 390 ? "24px" : "28px");
    expect(notebook.headerMargin).toBe(width === 390 ? "48px" : "120px");
    expect(notebook.introMargin).toBe(width === 390 ? "48px" : "104px");
    expect(notebook.rowHeight).toBeGreaterThanOrEqual(44);
    const disclosure = cover.getByRole("button", { name: /子目录 开始使用/ });
    const expanded = await disclosure.getAttribute("aria-expanded");
    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", expanded === "true" ? "false" : "true");
    expect(await page.locator(".workspace-main-area").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (width === 390) await page.getByRole("button", { name: "打开主导航", exact: true }).click();
    const sidebar = page.locator("#notebook-directory");
    await expect(sidebar).toBeVisible();
    const sidebarMetrics = await sidebar.evaluate(element => {
      const styles = (selector: string) => {
        const target = element.querySelector(selector)!;
        const css = getComputedStyle(target);
        return { width: target.getBoundingClientRect().width, height: target.getBoundingClientRect().height, padding: css.padding, margin: css.margin, fontSize: css.fontSize, fontWeight: css.fontWeight, lineHeight: css.lineHeight, letterSpacing: css.letterSpacing, color: css.color, background: css.backgroundColor, radius: css.borderRadius };
      };
      return { back: styles(".notebook-menu-back"), title: styles(".notebook-menu-title"), home: styles(".notebook-home-link"), row: styles(".document-context-row"), link: styles(".document-context-link"), disclosure: styles(".document-tree-disclosure"), tools: styles(".document-tree-tools .icon-button") };
    });
    expect(sidebarMetrics.back).toMatchObject({ width: 32, height: 32, padding: "2px 4px", margin: "0px", fontSize: "14px", fontWeight: "500", radius: "12px" });
    expect(sidebarMetrics.title).toMatchObject({ height: 36, margin: "6px 0px 0px", fontSize: "16px", fontWeight: "600", letterSpacing: "-0.16px" });
    await expect(sidebar.getByRole("button", { name: "定位当前文档", exact: true })).toBeDisabled();
    await expect(sidebar.getByRole("button", { name: "定位当前文档", exact: true })).toHaveCSS("opacity", "0.4");
    const firstRow = sidebar.locator('[data-note-id="00000000-0000-4000-8000-000000000006"] > .document-context-row');
    const actions = firstRow.locator(".document-context-actions");
    await expect(actions).toHaveCSS("width", "0px");
    await firstRow.hover();
    await expect(actions).toHaveCSS("width", "64px");
    await expect(firstRow.getByRole("button", { name: "新建子文档 开始使用", exact: true })).toBeVisible();
    await firstRow.getByRole("button", { name: "文档操作 开始使用", exact: true }).click();
    await page.mouse.move(width - 5, 850);
    await expect(actions).toHaveCSS("width", "64px");
    await expect(page.getByRole("menu", { name: "文档操作 开始使用", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await firstRow.getByRole("link", { name: "开始使用", exact: true }).focus();
    await expect(actions).toHaveCSS("width", "64px");
    if (width === 1280) {
      await page.getByRole("separator", { name: "调整笔记本目录宽度" }).press("Home");
      await firstRow.hover();
      await expect(actions).toHaveCSS("width", "32px");
      await expect(firstRow.getByRole("button", { name: "新建子文档 开始使用", exact: true })).toBeHidden();
    }
    expect((await new AxeBuilder({ page }).include("#notebook-directory").analyze()).violations).toEqual([]);
    await info.attach("layout-metrics", { body: JSON.stringify({ theme, width, overview, notebook, sidebar: sidebarMetrics }, null, 2), contentType: "application/json" });
  });
}

for (const theme of ["light", "dark"]) test(`document workbench ${theme} empty states retain readable text and creation entries`, async ({ page }) => {
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  await page.route(url => url.pathname.endsWith("/collections"), route => route.fulfill({ json: { code: "OK", message: "", request_id: "empty-layout", data: pageData([]) } }));
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "还没有笔记本" })).toBeVisible();
  expect((await new AxeBuilder({ page }).include(".notebook-overview").analyze()).violations).toEqual([]);
  await expect(page.getByRole("region", { name: "常用", exact: true })).toContainText("将笔记本设为常用");
});


test.describe("touch notebook directory", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 900 } });
  for (const theme of ["light", "dark"]) test(`${theme} retains a single 44px menu target and every creation action`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.goto(`/collections/${notebooks[0].id}`);
    await page.getByRole("button", { name: "打开主导航", exact: true }).click();
    const sidebar = page.locator("#notebook-directory");
    const firstRow = sidebar.locator('[data-note-id="00000000-0000-4000-8000-000000000006"] > .document-context-row');
    await expect(firstRow).toBeVisible();
    await expect(firstRow.locator(".document-context-actions")).toHaveCSS("width", "44px");
    await expect(firstRow.getByRole("button", { name: "新建子文档 开始使用", exact: true })).toBeHidden();
    const more = firstRow.getByRole("button", { name: "文档操作 开始使用", exact: true });
    await expect(more).toHaveCSS("width", "44px");
    await expect(more).toHaveCSS("height", "44px");
    await more.tap();
    const menu = page.getByRole("menu", { name: "文档操作 开始使用", exact: true });
    await expect(menu.getByRole("menuitem", { name: "新建子文档", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "重命名", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "归档", exact: true })).toBeVisible();
  });
});


test("notebook import retry retains the original operation and Markdown after an uncertain response", async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route(`**/collections/${notebooks[0].id}/imports/markdown`, async route => {
    expect(route.request().method()).toBe("POST");
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { code: "DOCUMENT_WRITE_RESULT_UNKNOWN", message: "导入结果尚未确认", request_id: "import-retry" } });
  });
  await page.goto(`/collections/${notebooks[0].id}`);
  const cover = page.getByRole("article", { name: "笔记本首页" });
  await expect(cover.getByRole("status", { name: "文档统计" })).toContainText("3 篇文档");
  await cover.getByRole("button", { name: "笔记本操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "导入 Markdown", exact: true }).click();
  await cover.locator('input[type="file"]').setInputFiles({ name: "原始文档.md", mimeType: "text/markdown", buffer: Buffer.from("# 原始内容\n\n保留不确定操作的完整内容。") });
  await expect(cover.getByRole("button", { name: "导入操作", exact: true })).toBeVisible();
  await cover.getByRole("button", { name: "导入操作", exact: true }).click();
  const actions = page.getByRole("dialog", { name: "导入操作", exact: true });
  await actions.getByRole("button", { name: "重试导入", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]).toEqual({ operation_id: expect.stringMatching(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i), title: "原始文档", markdown: "# 原始内容\n\n保留不确定操作的完整内容。", parent_id: null });
  expect(requests[1]).toEqual(requests[0]);
  await expect(actions.getByRole("button", { name: "重试导入", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(`/collections/${notebooks[0].id}`);
});

test("notebook editing restores the stable actions trigger after every close path", async ({ page }) => {
  const updates: Array<Record<string, unknown>> = [];
  await page.route(`**/collections/${notebooks[0].id}`, async route => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const payload = route.request().postDataJSON();
    updates.push(payload);
    await route.fulfill({ json: { code: "OK", message: "", request_id: "notebook-edit-focus", data: { ...notebooks[0], ...payload, metadata_version: 2 } } });
  });
  await page.goto(`/collections/${notebooks[0].id}`);
  const trigger = page.getByRole("article", { name: "笔记本首页" }).getByRole("button", { name: "笔记本操作", exact: true });

  for (const action of ["Escape", "取消", "关闭", "outside", "保存"]) {
    await trigger.click();
    await page.getByRole("menuitem", { name: "编辑笔记本", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑笔记本", exact: true });
    await expect(editor.getByRole("textbox", { name: "笔记本名称", exact: true })).toBeFocused();
    await editor.getByRole("textbox", { name: "笔记本名称", exact: true }).fill("修改后的笔记本");
    if (action === "Escape") await page.keyboard.press("Escape");
    else if (action === "outside") await page.mouse.click(5, 5);
    else await editor.getByRole("button", { name: action, exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(trigger).toBeFocused();
  }

  expect(updates).toEqual([{ expected_version: 1, title: "修改后的笔记本", icon: null }]);
});

for (const activation of ["keyboard", "mouse"] as const) test(`notebook creation restores its focused opener after ${activation} activation`, async ({ page }, info) => {
  await page.setViewportSize({ width: 735, height: 423 });
  await page.goto("/documents");
  const opener = page.getByRole("button", { name: "新建笔记本", exact: true });
  const focusStages: Array<{ stage: string; tag: string | null; label: string | null; text: string | null }> = [];
  async function recordFocus(stage: string) {
    focusStages.push({ stage, ...await page.evaluate(() => {
      const active = document.activeElement;
      return { tag: active?.tagName ?? null, label: active?.getAttribute("aria-label") ?? null, text: active?.textContent?.trim().slice(0, 80) ?? null };
    }) });
  }
  try {
    await opener.focus();
    await expect(opener).toBeFocused();
    await recordFocus("before-open");
    if (activation === "keyboard") await page.keyboard.press("Enter");
    else await opener.click();
    const dialog = page.getByRole("dialog", { name: "新建笔记本", exact: true });
    await expect(dialog.getByRole("textbox", { name: "笔记本名称", exact: true })).toBeFocused();
    await recordFocus("after-open");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await recordFocus("after-hidden");
    await expect(opener).toBeFocused();
    await recordFocus("restored");
  } finally {
    await info.attach("notebook-create-focus", { body: JSON.stringify({ activation, focusStages }, null, 2), contentType: "application/json" });
  }
});

test("empty notebook overview restores the actual creation opener through every dismissal", async ({ page }) => {
  await page.setViewportSize({ width: 735, height: 423 });
  await page.route("**/api/v1/**", async route => {
    if (!new URL(route.request().url()).pathname.endsWith("/collections")) return route.fallback();
    await route.fulfill({ json: { code: "OK", message: "", request_id: "empty-notebook-focus", data: { items: [], pagination: { page: 1, page_size: 20, total: 0 } } } });
  });
  await page.goto("/documents");
  const openers = page.getByRole("button", { name: "新建笔记本", exact: true });
  await expect(openers).toHaveCount(2);
  for (const opener of await openers.all()) for (const dismissal of ["Escape", "取消", "关闭", "outside"]) {
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "新建笔记本", exact: true });
    await expect(dialog.getByRole("textbox", { name: "笔记本名称", exact: true })).toBeFocused();
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    else if (dismissal === "outside") await page.mouse.click(5, 5);
    else await dialog.getByRole("button", { name: dismissal, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  }
});

test("notebook group creation restores its focused opener after Escape", async ({ page }, info) => {
  await page.setViewportSize({ width: 735, height: 423 });
  await page.goto("/documents/collections");
  const opener = page.getByRole("button", { name: "新建分组", exact: true });
  await opener.focus();
  await expect(opener).toBeFocused();
  const before = await opener.evaluate(element => ({ tag: document.activeElement?.tagName, openerFocused: document.activeElement === element }));
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "新建分组", exact: true });
  const input = dialog.getByRole("textbox", { name: "分组名称", exact: true });
  await expect(input).toBeFocused();
  const opened = await input.evaluate(element => ({ tag: document.activeElement?.tagName, inputFocused: document.activeElement === element }));
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const closed = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim().slice(0, 80) }));
  await info.attach("notebook-group-create-focus", { body: JSON.stringify({ before, opened, closed }, null, 2), contentType: "application/json" });
  await expect(opener).toBeFocused();
});

for (const theme of ["light", "dark"]) test(`collection and profile ${theme} keep responsive content and readable metadata`, async ({ page }, info) => {
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  const metrics = [];
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/documents/collections");
    const collections = page.locator(".workspace-route-content");
    await expect(collections.getByRole("heading", { name: "我的笔记本", exact: true })).toBeVisible();
    await expect(collections.locator(".workbench-collection-card")).toHaveCount(3);
    await collections.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    expect((await new AxeBuilder({ page }).include(".workspace-route-content").analyze()).violations).toEqual([]);
    const cards = await collections.locator(".workbench-collection-card").evaluateAll(elements => elements.map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, radius: getComputedStyle(element).borderRadius })));
    expect(cards.every(card => card.width > 250 && card.height >= 96 && card.radius === "15px")).toBe(true);
    expect(await collections.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.goto("/settings/account");
    const profile = page.getByRole("region", { name: "个人资料", exact: true });
    await expect(profile.getByRole("textbox", { name: "名称", exact: true })).toHaveValue(user.display_name);
    await expect(profile.getByRole("textbox", { name: "个人简介", exact: true })).toHaveValue(user.bio);
    await page.locator(".workspace-route-content").evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    expect((await new AxeBuilder({ page }).include(".workspace-route-content").analyze()).violations).toEqual([]);
    const form = await profile.locator("form").evaluate(element => ({ width: element.getBoundingClientRect().width, gap: getComputedStyle(element).gap }));
    expect(form.gap).toBe("24px");
    expect(form.width).toBeLessThanOrEqual(520);
    expect(await page.locator(".workspace-main-area").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    metrics.push({ theme, width, cards, form });
  }
  await info.attach("collection-profile-metrics", { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });
});
