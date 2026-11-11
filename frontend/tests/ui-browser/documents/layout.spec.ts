import { Buffer } from "node:buffer";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoContinuingMotion, expectVisibleKeyboardFocus } from "../fixtures/media";

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

test("recent edits filter by title and notebook without losing content types", async ({ page }) => {
  const sheet = { ...notes[1], collection_id: notebooks[1].id, title: "安装计划表", sheet_id: "00000000-0000-4000-8000-000000000010", updated_at_ms: now - 86_400_000 };
  await page.route(url => url.pathname.endsWith("/documents") && !url.pathname.includes("/collections/"), route =>
    route.fulfill({ json: { code: "OK", message: "", request_id: "recent-layout", data: pageData([notes[0], sheet]) } }),
  );
  await page.goto("/documents/recent");
  await expect(page.getByRole("region", { name: "今天", exact: true }).getByRole("link", { name: notes[0].title, exact: true })).toBeVisible();
  const yesterday = page.getByRole("region", { name: "昨天", exact: true });
  await expect(yesterday.getByRole("link", { name: sheet.title, exact: true })).toHaveAttribute("href", `/documents/${sheet.id}`);
  await expect(yesterday.getByTitle("数据表", { exact: true })).toBeVisible();

  await page.getByRole("searchbox", { name: "搜索文档标题" }).fill("安装");
  await expect(page.getByRole("link", { name: notes[0].title, exact: true })).toHaveCount(0);
  const selector = page.getByRole("combobox", { name: "按笔记本筛选" });
  await selector.click();
  await page.getByRole("option", { name: notebooks[0].title, exact: true }).click();
  await expect(page.getByText("没有符合条件的文档。")).toBeVisible();
  await selector.click();
  await page.getByRole("option", { name: notebooks[1].title, exact: true }).click();
  await expect(yesterday.getByRole("link", { name: sheet.title, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "搜索文档标题" })).toHaveValue("安装");
  await expect(selector).toContainText(notebooks[1].title);
  await expect(yesterday.getByRole("link", { name: sheet.title, exact: true })).toBeVisible();
});

test("the shelf can create a group and open it for management", async ({ page }) => {
  const createdGroup = { ...group, id: "00000000-0000-4000-8000-000000000042", name: "新项目", is_default: false, sort_order: 1 };
  let created = false;
  await page.route(url => url.pathname.endsWith("/collection-groups"), async route => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ name: createdGroup.name, sort_order: 1 });
      created = true;
      await route.fulfill({ status: 201, json: { code: "OK", message: "", request_id: "new-group", data: createdGroup } });
    } else {
      await route.fulfill({ json: { code: "OK", message: "", request_id: "list-groups", data: pageData(created ? [group, createdGroup] : [group]) } });
    }
  });
  await page.goto("/documents");
  await page.getByRole("button", { name: "新建分组", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建分组", exact: true });
  await dialog.getByRole("textbox", { name: "分组名称" }).fill(createdGroup.name);
  await dialog.getByRole("button", { name: "创建分组", exact: true }).click();
  await expect(page).toHaveURL(`/documents/collections?group=${createdGroup.id}`);
  const target = page.locator(`#group-${createdGroup.id}`);
  await expect(target.getByRole("button", { name: /收起分组 新项目/ })).toBeVisible();
  await expect(target).toBeFocused();
});

test("notebook map and sidebar search follow the real directory hierarchy", async ({ page }) => {
  await page.goto(`/collections/${notebooks[0].id}`);
  const shortcuts = page.getByRole("button", { name: "常用笔记本", exact: true });
  await shortcuts.hover();
  const popup = page.getByRole("dialog", { name: "常用笔记本", exact: true });
  await expect(popup.getByRole("link", { name: notebooks[0].title, exact: true })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();

  await page.getByRole("tab", { name: "脑图", exact: true }).click();
  const map = page.getByRole("region", { name: "笔记本目录脑图", exact: true });
  const child = map.getByRole("link", { name: notes[1].title, exact: true });
  await expect(child).toHaveAttribute("href", `/documents/${notes[1].id}`);
  await map.getByRole("button", { name: `收起脑图分支：${notes[0].title}` }).click();
  await expect(child).toHaveCount(0);
  await map.getByRole("button", { name: `展开脑图分支：${notes[0].title}` }).click();
  await expect(child).toBeVisible();
  await page.getByRole("button", { name: "放大脑图" }).click();
  await expect(page.getByRole("status", { name: "脑图缩放比例" })).toHaveText("125%");
  await page.getByRole("button", { name: "重置脑图视图" }).click();
  await expect(page.getByRole("status", { name: "脑图缩放比例" })).toHaveText("100%");

  const sidebar = page.getByRole("navigation", { name: "笔记本目录", exact: true });
  await sidebar.getByRole("searchbox", { name: "搜索笔记本" }).fill(notes[1].title);
  await expect(sidebar.getByRole("link", { name: notes[1].title, exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: notes[0].title, exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: notes[2].title, exact: true })).toHaveCount(0);
  await sidebar.getByRole("searchbox", { name: "搜索笔记本" }).clear();
  await expect(sidebar.getByRole("link", { name: notes[2].title, exact: true })).toBeVisible();
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
    expect(overview.gap).toBe("18px");
    expect(overview.cards.every(card => card.width > 0 && card.height > 0)).toBe(true);
    expect(overview.columns).toBe(width === 390 ? 1 : 4);
    expect((await new AxeBuilder({ page }).include(".notebook-overview").analyze()).violations).toEqual([]);
    const pinned = page.getByRole("region", { name: "置顶笔记本", exact: true });
    await expect(pinned.locator(".notebook-overview-card")).toHaveCount(1);
    await pinned.getByRole("button", { name: /^置顶笔记本/, expanded: true }).click();
    await expect(pinned.locator(".notebook-overview-card")).toHaveCount(0);
    await pinned.getByRole("button", { name: /^置顶笔记本/, expanded: false }).click();
    await pinned.getByRole("link", { name: notebooks[0].title, exact: true }).click();
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
    expect(parseFloat(notebook.radius)).toBeGreaterThan(0);
    expect(notebook.titleSize).toBe(width === 390 ? "24px" : "28px");
    expect(notebook.headerMargin).toBe("28px");
    expect(notebook.introMargin).toBe("28px");
    expect(notebook.rowHeight).toBeGreaterThanOrEqual(24);
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
      return { back: styles(".notebook-menu-back"), title: styles(".notebook-menu-title"), home: styles(".notebook-home-link"), row: styles(".document-context-row"), link: styles(".document-context-link"), disclosure: styles(".document-tree-disclosure"), tools: styles(".document-tree-tools button") };
    });
    expect(sidebarMetrics.back.width).toBeGreaterThanOrEqual(24);
    expect(sidebarMetrics.back.height).toBeGreaterThanOrEqual(24);
    expect(sidebarMetrics.title.height).toBeGreaterThanOrEqual(24);
    expect(sidebarMetrics.title.width).toBeGreaterThan(0);
    await expect(sidebar.getByRole("button", { name: "定位当前文档", exact: true })).toBeDisabled();

    const firstRow = sidebar.locator('[data-note-id="00000000-0000-4000-8000-000000000006"] > .document-context-row');
    const actions = firstRow.locator(".document-context-actions");
    await expect(actions).toHaveCSS("width", "0px");
    await firstRow.hover();
    await expect.poll(() => actions.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(48);
    await expect(firstRow.getByRole("button", { name: "新建子文档 开始使用", exact: true })).toBeVisible();
    await firstRow.getByRole("button", { name: "文档操作 开始使用", exact: true }).click();
    await page.mouse.move(width - 5, 850);
    await expect.poll(() => actions.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(48);
    await expect(page.getByRole("menu", { name: "文档操作 开始使用", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await firstRow.getByRole("link", { name: "开始使用", exact: true }).focus();
    await expect.poll(() => actions.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(48);
    if (width === 1280) {
      await page.getByRole("separator", { name: "调整笔记本目录宽度" }).press("Home");
      await firstRow.hover();
      await expect.poll(() => actions.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(24);
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
  await expect(page.getByRole("region", { name: "置顶笔记本", exact: true })).toContainText("将笔记本设为常用");
});


test.describe("touch notebook directory", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 900 } });
  for (const theme of ["light", "dark"]) test(`${theme} retains one operable menu target and every creation action`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.goto(`/collections/${notebooks[0].id}`);
    await page.getByRole("button", { name: "打开主导航", exact: true }).click();
    const sidebar = page.locator("#notebook-directory");
    const firstRow = sidebar.locator('[data-note-id="00000000-0000-4000-8000-000000000006"] > .document-context-row');
    await expect(firstRow).toBeVisible();
    await expect.poll(() => firstRow.locator(".document-context-actions").evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(24);
    await expect(firstRow.getByRole("button", { name: "新建子文档 开始使用", exact: true })).toBeHidden();
    const more = firstRow.getByRole("button", { name: "文档操作 开始使用", exact: true });
    expect((await more.boundingBox())!.width).toBeGreaterThanOrEqual(24);
    expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(24);
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
    expect(cards.every(card => card.width > 0 && card.height > 0)).toBe(true);
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

for (const { theme, width } of [{ theme: "light", width: 1280 }, { theme: "dark", width: 390 }] as const) test(`media acceptance: documents ${theme} ${width} keeps cancelled creation and directory keyboard sessions`, async ({ page }, info) => {
  const writes: string[] = [];
  const evidence: Record<string, unknown> = { theme, width, forcedColors: "active", reducedMotion: "reduce", writes };
  page.on("request", request => { if (request.url().includes("/api/v1/") && request.method() !== "GET") writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  try {
    await page.goto("/documents");
    await expect(page.getByRole("heading", { name: "我的文档", exact: true })).toBeVisible();
    const opener = page.getByRole("button", { name: "新建笔记本", exact: true });
    await opener.focus();
    evidence.overviewFocus = await expectVisibleKeyboardFocus(opener);
    await page.keyboard.press("Enter");
    const creation = page.getByRole("dialog", { name: "新建笔记本", exact: true });
    const name = creation.getByRole("textbox", { name: "笔记本名称", exact: true });
    evidence.createFocus = await expectVisibleKeyboardFocus(name);
    await page.keyboard.type("未提交的媒体笔记本");
    await expect(name).toHaveValue("未提交的媒体笔记本");
    evidence.createMotion = await expectNoContinuingMotion(creation);
    const createAxe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(createAxe.violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(creation).toBeHidden();
    evidence.restoredOverviewFocus = await expectVisibleKeyboardFocus(opener);
    await expect(page.locator(".notebook-overview-card")).toHaveCount(4);

    const notebookLink = page.getByRole("region", { name: "置顶笔记本", exact: true }).getByRole("link", { name: notebooks[0].title, exact: true });
    await notebookLink.focus();
    evidence.notebookLinkFocus = await expectVisibleKeyboardFocus(notebookLink);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/collections/${notebooks[0].id}`);
    await expect(page.getByRole("article", { name: "笔记本首页", exact: true })).toBeVisible();
    if (width === 390) {
      const navigation = page.getByRole("button", { name: "打开主导航", exact: true });
      await navigation.focus();
      await page.keyboard.press("Enter");
    }
    const sidebar = page.locator("#notebook-directory");
    const disclosure = sidebar.getByRole("button", { name: /子目录 开始使用/ });
    await disclosure.focus();
    evidence.treeFocus = await expectVisibleKeyboardFocus(disclosure);
    const expanded = await disclosure.getAttribute("aria-expanded");
    await page.keyboard.press("Space");
    await expect(disclosure).toHaveAttribute("aria-expanded", expanded === "true" ? "false" : "true");
    const child = sidebar.getByRole("link", { name: "安装与配置", exact: true });
    if (expanded === "true") await expect(child).toBeHidden();
    else await expect(child).toBeVisible();
    const menuTrigger = sidebar.getByRole("button", { name: "文档操作 开始使用", exact: true });
    await menuTrigger.focus();
    evidence.menuTriggerFocus = await expectVisibleKeyboardFocus(menuTrigger);
    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu", { name: "文档操作 开始使用", exact: true });
    const createChild = menu.getByRole("menuitem", { name: "新建子文档", exact: true });
    evidence.menuPaint = await menu.evaluate(element => ({
      container: { color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor, forcedColorAdjust: getComputedStyle(element).forcedColorAdjust },
      items: Array.from(element.querySelectorAll('[role="menuitem"]')).map(item => ({ text: item.textContent, focused: document.activeElement === item, highlighted: item.hasAttribute("data-highlighted"), color: getComputedStyle(item).color, background: getComputedStyle(item).backgroundColor, outline: getComputedStyle(item).outline, border: getComputedStyle(item).border, forcedColorAdjust: getComputedStyle(item).forcedColorAdjust })),
    }));
    evidence.menuItemFocus = await expectVisibleKeyboardFocus(createChild);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    evidence.restoredMenuFocus = await expectVisibleKeyboardFocus(menuTrigger);
    await page.keyboard.press("Enter");
    await expect(createChild).toBeFocused();
    await page.keyboard.press("Enter");
    const childCreation = page.getByRole("dialog", { name: "新建子文档", exact: true });
    const childTitle = childCreation.getByRole("textbox", { name: "文档标题", exact: true });
    evidence.childCreateFocus = await expectVisibleKeyboardFocus(childTitle);
    await page.keyboard.type("尚未创建的子文档");
    await expect(childTitle).toHaveValue("尚未创建的子文档");
    evidence.childCreateMotion = await expectNoContinuingMotion(childCreation);
    await page.keyboard.press("Escape");
    await expect(childCreation).toBeHidden();
    evidence.closedChildFocus = await expectVisibleKeyboardFocus(menuTrigger);
    evidence.directoryMotion = await expectNoContinuingMotion(sidebar);
    const directoryAxe = await new AxeBuilder({ page }).include("#notebook-directory").analyze();
    evidence.axe = { creation: createAxe.violations, directory: directoryAxe.violations };
    expect(directoryAxe.violations).toEqual([]);
    expect(writes).toEqual([]);
  } finally {
    await info.attach("documents-media-acceptance", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  }
});
