import { expect, test, type Page } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });

const DEFAULT_ROOT_FONT_SIZE = 16;
const MAX_DEFAULT_UI_FONT_SIZE = 18;

async function setRootFontSize(page: Page, size: number) {
  await page.evaluate(value => document.documentElement.style.fontSize = `${value}px`, size);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${size}px`);
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
}

async function expectVisibleUiFontLimit(page: Page, rootSize: number, label: string) {
  const oversized = await page.evaluate(maximum => {
    const excluded = "script, style, svg, noscript, .sr-only, [hidden], [inert], [aria-hidden=true], .document-prose, .ProseMirror, [contenteditable=true], .site-reader";
    const seen = new Set<Element>();
    const results: Array<{ tag: string; className: string; text: string; fontSize: number }> = [];
    function inspect(element: HTMLElement, text: string) {
      if (seen.has(element) || element.closest(excluded) || !text.trim()) return;
      seen.add(element);
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return;
      const box = element.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1 || box.right <= 0 || box.bottom <= 0 || box.left >= innerWidth || box.top >= innerHeight) return;
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (size > maximum + .1) results.push({ tag: element.tagName.toLowerCase(), className: element.className, text: text.trim().slice(0, 60), fontSize: size });
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement instanceof HTMLElement) inspect(node.parentElement, node.textContent ?? "");
    }
    for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select")) {
      inspect(field, field.getAttribute("aria-label") || field.getAttribute("placeholder") || field.tagName);
    }
    return results;
  }, MAX_DEFAULT_UI_FONT_SIZE * rootSize / DEFAULT_ROOT_FONT_SIZE);
  expect(oversized, `${label}: visible product UI exceeds the scaled 18px limit`).toEqual([]);
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.com");
  await page.getByLabel("密码", { exact: true }).fill("Orbis-browser-test-2026!");
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/(documents|home)$/);
}

for (const surface of ["web", "desktop"] as const) test(`${surface} semantic typography preserves hierarchy, the UI ceiling and user font scaling`, async ({ page, request }) => {
  if (surface === "desktop") await page.addInitScript(() => Object.assign(window, { __ORBIS_HOST__: { surface: "desktop" } }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect([201, 409]).toContain((await request.post("/api/setup", { data: {
    email: "owner@example.com", password: "Orbis-browser-test-2026!", display_name: "设计规范验收",
  } })).status());
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登录工作空间", exact: true })).toBeVisible();
  await expectVisibleUiFontLimit(page, 16, `${surface}: login`);
  await login(page);
  const headers = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("orbis.auth")!);
    return { Authorization: `Bearer ${session.accessToken}`, "X-Workspace-ID": session.workspace.id as string };
  });
  const title = `规范笔记本-${Date.now()}`;
  expect((await request.post("/api/notebooks", { headers, data: { title, sort_order: 0 } })).status()).toBe(201);
  await page.goto("/documents");
  const cardTitle = page.locator(".notebook-overview-card-copy strong").filter({ hasText: title });
  await expect(cardTitle).toBeVisible();
  for (const rootSize of [16, 20]) {
    await setRootFontSize(page, rootSize);
    const section = await page.locator(".workbench-section-heading h2").last().evaluate(element => {
      const style = getComputedStyle(element);
      return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight), leading: parseFloat(style.lineHeight), root: getComputedStyle(document.documentElement).fontSize, token: style.getPropertyValue("--orbis-text-section-size") };
    });
    const child = await cardTitle.evaluate(element => {
      const style = getComputedStyle(element);
      return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight), leading: parseFloat(style.lineHeight) };
    });
    expect(section.size, JSON.stringify(section)).toBe(rootSize);
    expect(section.leading).toBe(rootSize * 1.5);
    expect(section.weight).toBe(600);
    expect(child.size).toBe(rootSize * .875);
    expect(child.leading).toBe(rootSize * 1.25);
    expect(child.weight).toBe(500);
    expect(section.size).toBeGreaterThan(child.size);
    expect(section.weight).toBeGreaterThanOrEqual(child.weight);
    const heading = await page.locator(".page-title").evaluate(element => {
      const style = getComputedStyle(element);
      return { size: parseFloat(style.fontSize), leading: parseFloat(style.lineHeight), weight: Number(style.fontWeight) };
    });
    expect(heading).toEqual({ size: rootSize * 18 / 16, leading: rootSize * 26 / 16, weight: 600 });
    const caption = await cardTitle.locator("..").locator("span").first().evaluate(element => {
      const style = getComputedStyle(element);
      return { size: parseFloat(style.fontSize), leading: parseFloat(style.lineHeight) };
    });
    expect(caption).toEqual({ size: rootSize * 12 / 16, leading: rootSize * 18 / 16 });
    const items = await page.locator(".workspace-function-link").evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height > 0).map(element => {
      const style = getComputedStyle(element);
      return { size: parseFloat(style.fontSize), height: element.getBoundingClientRect().height };
    }));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.size).toBe(rootSize * .875);
      expect(item.height).toBeGreaterThanOrEqual(rootSize * 2.25);
    }
    await expectVisibleUiFontLimit(page, rootSize, `${surface}: document overview at root ${rootSize}`);
  }
  for (const path of ["/home", "/documents/collections", "/sites", "/knowledge", "/memory", "/settings/account", "/settings/members"]) {
    await page.goto(path);
    await expect(page.locator(".workspace-shell")).toHaveAttribute("data-app-surface", surface);
    const main = page.getByRole("region", { name: "主工作区", exact: true });
    if (path === "/knowledge" || path === "/memory") await expect(main.getByText(/正在建设中$/)).toBeVisible();
    else await expect(main.getByRole("heading").first()).toBeVisible();
    for (const rootSize of [16, 20]) {
      await setRootFontSize(page, rootSize);
      await expectVisibleUiFontLimit(page, rootSize, `${surface}: ${path} at root ${rootSize}`);
    }
  }
  await page.goto("/documents");
  for (const rootSize of [16, 20]) {
    await setRootFontSize(page, rootSize);
    await page.getByRole("button", { name: "打开用户菜单", exact: true }).click();
    await expect(page.locator(".workspace-user-popover").getByRole("menu")).toBeVisible();
    await expectVisibleUiFontLimit(page, rootSize, `${surface}: user menu at root ${rootSize}`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "切换工作空间", exact: true }).click();
    await expect(page.getByRole("list", { name: "可用工作空间", exact: true })).toBeVisible();
    await expectVisibleUiFontLimit(page, rootSize, `${surface}: workspace selector at root ${rootSize}`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "新建资产", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "新建资产", exact: true })).toBeVisible();
    await expectVisibleUiFontLimit(page, rootSize, `${surface}: creation dialog at root ${rootSize}`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog", { name: "全局搜索", exact: true })).toBeVisible();
    await expectVisibleUiFontLimit(page, rootSize, `${surface}: search palette at root ${rootSize}`);
    await page.keyboard.press("Escape");
  }
});

test("common form and dialog roles retain the same size and focus semantics in both themes", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect([201, 409]).toContain((await request.post("/api/setup", { data: {
    email: "owner@example.com", password: "Orbis-browser-test-2026!", display_name: "设计规范验收",
  } })).status());
  await login(page);
  await page.goto("/documents");
  const trigger = page.locator(".page-actions").getByRole("button", { name: "新建笔记本", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "新建笔记本", exact: true });
  const input = dialog.getByLabel("笔记本名称", { exact: true });
  await expect(input).toBeFocused();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    for (const rootSize of [16, 20]) {
      await setRootFontSize(page, rootSize);
      const heading = await dialog.getByRole("heading", { name: "新建笔记本" }).evaluate(element => {
        const style = getComputedStyle(element);
        return { size: parseFloat(style.fontSize), leading: parseFloat(style.lineHeight), weight: Number(style.fontWeight), root: getComputedStyle(document.documentElement).fontSize, token: style.getPropertyValue("--orbis-text-panel-title-size") };
      });
      expect({ size: heading.size, leading: heading.leading, weight: heading.weight }, JSON.stringify(heading)).toEqual({ size: rootSize, leading: rootSize * 1.5, weight: 600 });
      await expect.poll(() => input.evaluate(element => element.getBoundingClientRect().height)).toBe(rootSize * 2.5);
      const field = await input.evaluate(element => ({ height: element.getBoundingClientRect().height, size: parseFloat(getComputedStyle(element).fontSize) }));
      expect(field).toEqual({ height: rootSize * 2.5, size: rootSize * .875 });
      for (const label of ["取消", "创建"]) {
        const button = await dialog.getByRole("button", { name: label, exact: true }).evaluate(element => ({ height: element.getBoundingClientRect().height, size: parseFloat(getComputedStyle(element).fontSize) }));
        expect(button).toEqual({ height: rootSize * 2.25, size: rootSize * .875 });
      }
      await expectVisibleUiFontLimit(page, rootSize, `${theme}: notebook dialog at root ${rootSize}`);
    }
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("touch editor keeps enlarged controls reachable on a narrow screen", async ({ browser, baseURL, request }) => {
  expect([201, 409]).toContain((await request.post("/api/setup", { data: {
    email: "owner@example.com", password: "Orbis-browser-test-2026!", display_name: "设计规范验收",
  } })).status());
  const context = await browser.newContext({ baseURL, viewport: { width: 320, height: 800 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    await login(page);
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
    const headers = { Authorization: `Bearer ${token}` };
    const notebook = await request.post("/api/notebooks", { headers, data: { title: "触摸编辑器", sort_order: 0 } });
    const notebookId = (await notebook.json()).data.id;
    const note = await request.post("/api/notes", { headers, data: { notebook_id: notebookId, title: "触摸目标", parent_id: null, sort_order: 0 } });
    const noteId = (await note.json()).data.id;
    await page.goto(`/documents/${noteId}`);
    await expect(page.locator(".ProseMirror")).toBeVisible();
    for (const rootSize of [16, 20]) {
      await setRootFontSize(page, rootSize);
      const layout = await page.evaluate(() => {
        const toolbar = document.querySelector<HTMLElement>(".document-format-host .orbis-tiptap-toolbar")!;
        toolbar.scrollLeft = toolbar.scrollWidth;
        const bounds = toolbar.getBoundingClientRect();
        const insert = toolbar.querySelector<HTMLElement>(".orbis-tiptap-insert")!.getBoundingClientRect();
        const header = document.querySelector<HTMLElement>(".workspace-document-content > .workspace-toolbar")!.getBoundingClientRect();
        const drawerButton = document.querySelector<HTMLElement>(".workspace-document-content .workspace-mobile-drawer-control")!.getBoundingClientRect();
        return { overflow: getComputedStyle(toolbar).overflowX, insertRight: insert.right, toolbarRight: bounds.right, headerTop: header.top, headerBottom: header.bottom, buttonTop: drawerButton.top, buttonBottom: drawerButton.bottom, buttonHeight: drawerButton.height };
      });
      expect(layout.overflow).toBe("auto");
      expect(layout.insertRight).toBeLessThanOrEqual(layout.toolbarRight + 1);
      expect(layout.buttonHeight).toBeGreaterThanOrEqual(44);
      expect(layout.buttonTop).toBeGreaterThanOrEqual(layout.headerTop);
      expect(layout.buttonBottom).toBeLessThanOrEqual(layout.headerBottom);
    }
  } finally { await context.close(); }
});
