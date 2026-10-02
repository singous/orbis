import { expect, test, type Page } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.com");
  await page.getByLabel("密码", { exact: true }).fill("Orbis-browser-test-2026!");
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/(documents|home)$/);
}

test("semantic typography preserves parent hierarchy and scales with user font size", async ({ page, request }) => {
  expect([201, 409]).toContain((await request.post("/api/setup", { data: {
    email: "owner@example.com", password: "Orbis-browser-test-2026!", display_name: "设计规范验收",
  } })).status());
  await login(page);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
  const title = `规范笔记本-${Date.now()}`;
  expect((await request.post("/api/notebooks", { headers: { Authorization: `Bearer ${token}` }, data: { title, sort_order: 0 } })).status()).toBe(201);
  await page.goto("/documents");
  const cardTitle = page.locator(".notebook-overview-card-copy strong").filter({ hasText: title });
  await expect(cardTitle).toBeVisible();
  for (const rootSize of [16, 20]) {
    await page.evaluate(size => document.documentElement.style.fontSize = `${size}px`, rootSize);
    const section = await page.locator(".workbench-section-heading h2").last().evaluate(element => {
      const style = getComputedStyle(element);
      return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight) };
    });
    const child = await cardTitle.evaluate(element => {
      const style = getComputedStyle(element);
      return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight) };
    });
    expect(section.size).toBe(rootSize);
    expect(child.size).toBe(rootSize * .875);
    expect(section.size).toBeGreaterThan(child.size);
    expect(section.weight).toBeGreaterThanOrEqual(child.weight);
    expect(await page.locator(".page-title").evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBe(rootSize * 1.5);
    const items = await page.locator(".workspace-function-link").evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height > 0).map(element => {
      const style = getComputedStyle(element);
      return { size: parseFloat(style.fontSize), height: element.getBoundingClientRect().height };
    }));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.size).toBe(rootSize * .875);
      expect(item.height).toBeGreaterThanOrEqual(rootSize * 2.25);
    }
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
    expect(await dialog.getByRole("heading", { name: "新建笔记本" }).evaluate(element => getComputedStyle(element).fontSize)).toBe("20px");
    await expect.poll(() => input.evaluate(element => element.getBoundingClientRect().height)).toBe(40);
    const field = await input.evaluate(element => ({ height: element.getBoundingClientRect().height, size: getComputedStyle(element).fontSize }));
    expect(field.height).toBe(40);
    expect(field.size).toBe("14px");
    for (const label of ["取消", "创建"]) {
      const button = await dialog.getByRole("button", { name: label, exact: true }).evaluate(element => ({ height: element.getBoundingClientRect().height, size: getComputedStyle(element).fontSize }));
      expect(button).toEqual({ height: 36, size: "14px" });
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
      await page.evaluate(size => document.documentElement.style.fontSize = `${size}px`, rootSize);
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
