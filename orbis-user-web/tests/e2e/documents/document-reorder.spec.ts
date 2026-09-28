import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };

async function signIn(page: Page, request: APIRequestContext) {
  const setup = await request.post("/api/setup", { data: { ...owner, display_name: "目录排序验收" } });
  expect([201, 409]).toContain(setup.status());
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
}

test("notebook directories fold, keep compact actions, and preserve sibling drag order", async ({ page, request, browser }) => {
  await signIn(page, request);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post("/api/notebooks", { headers, data: { title: "排序验证", sort_order: 0 } });
  expect(created.status()).toBe(201);
  const notebookId = (await created.json()).data.id as string;
  async function createNote(title: string, sortOrder: number, parentId: string | null = null) {
    const response = await request.post("/api/notes", { headers, data: { notebook_id: notebookId, title, parent_id: parentId, sort_order: sortOrder } });
    expect(response.status()).toBe(201);
    return (await response.json()).data.id as string;
  }
  const first = await createNote("第一篇", 0);
  const second = await createNote("第二篇", 1);
  const third = await createNote("第三篇", 2);
  const childTitle = "第一篇的子文档：组件尺寸、禁用状态、键盘操作和移动端展示约定";
  const child = await createNote(childTitle, 0, first);
  const secondChild = await createNote("第一篇的另一篇子文档", 1, first);
  const treeUrl = `/api/notebooks/${notebookId}/notes/tree`;
  async function readTree() {
    const response = await request.get(treeUrl, { headers });
    expect(response.ok()).toBe(true);
    return (await response.json()).data.items as Array<{ id: string; children: Array<{ id: string }> }>;
  }

  await page.goto(`/collections/${notebookId}`);
  const main = page.getByRole("navigation", { name: "文档列表" });
  await expect(main.getByRole("link", { name: childTitle, exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "笔记本首页" })).toHaveAttribute("aria-current", "page");
  const sidebar = page.getByRole("navigation", { name: "笔记本文档" });
  await main.getByRole("button", { name: "收起子目录 第一篇", exact: true }).click();
  await expect(main.getByRole("link", { name: childTitle, exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: childTitle, exact: true })).toHaveCount(0);
  await expect(page.getByText("5 篇文档", { exact: true })).toBeVisible();
  await page.reload();
  await expect(main.getByRole("button", { name: "展开子目录 第一篇", exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.goto(`/documents/${child}`);
  await expect(sidebar.getByRole("link", { name: childTitle, exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "笔记本首页" }).click();
  await expect(page).toHaveURL(new RegExp(`/collections/${notebookId}$`));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    if (width === 390) await expect(page.locator(".workspace-main-navigation")).toBeHidden();
    const row = main.locator('.document-main-item[data-parent-id="root"] > .document-main-row').first();
    await expect(row).toBeVisible();
    if (width === 1440) await row.hover();
    const bounds = await row.evaluate((element) => {
      const line = element.getBoundingClientRect();
      const link = element.querySelector("a")!.getBoundingClientRect();
      const actions = element.querySelector(".document-context-actions")!.getBoundingClientRect();
      const content = document.querySelector('.workspace-content')!;
      return { overlap: link.left < actions.right && link.right > actions.left && link.top < actions.bottom && link.bottom > actions.top, outside: actions.top < line.top || actions.bottom > line.bottom, overflow: document.documentElement.scrollWidth - window.innerWidth, contentOverflow: content.scrollWidth - content.clientWidth };
    });
    expect(bounds.overlap).toBe(false);
    expect(bounds.outside).toBe(false);
    expect.soft(bounds.overflow).toBeLessThanOrEqual(1);
    expect.soft(bounds.contentOverflow).toBeLessThanOrEqual(1);
    expect((await row.boundingBox())!.height).toBeLessThanOrEqual(48);
    if (width === 1440) await expect(row.getByRole("button", { name: "新建子文档 第一篇" })).toBeVisible();
    const more = row.getByRole("button", { name: "文档操作 第一篇" });
    await more.click();
    await expect(page.getByRole("menuitem", { name: "新建子文档", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "重命名", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "归档", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    await expect(row.getByRole("button", { name: /上移|下移/ })).toHaveCount(0);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  const handle = main.getByRole("button", { name: "拖动排序 第三篇", exact: true });
  const target = main.getByRole("button", { name: "拖动排序 第一篇", exact: true });
  await expect(handle).toHaveAttribute("aria-roledescription", "draggable");
  const start = (await handle.boundingBox())!;
  const end = (await target.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.waitForTimeout(80); // Allow the hovered control to bind its drag sensor before pressing.
  await page.mouse.down();
  try {
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 - 9, { steps: 3 });
    await expect(handle).toHaveAttribute("aria-grabbed", "true");
    await page.mouse.move(end.x + end.width / 2, end.y + 3, { steps: 16 });
    await page.waitForTimeout(100); // Let the drag target settle before releasing the pointer.
  } finally {
    await page.mouse.up();
  }
  await expect.poll(async () => (await readTree()).map((note) => note.id)).toEqual([third, first, second]);
  expect((await readTree())[1].children.map((note) => note.id)).toEqual([child, secondChild]);

  // The backend order is visible before the browser finishes its save response.
  await expect(handle).toBeEnabled();
  await handle.press("Alt+ArrowDown");
  await expect.poll(async () => (await readTree()).map((note) => note.id)).toEqual([first, third, second]);
  await expect(handle).toBeFocused();
  await expect(handle).toBeEnabled();
  await expect(handle).toBeFocused();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(async () => (await readTree()).map((note) => note.id)).toEqual([first, second, third]);
  await expect(handle).toBeFocused();

  let releasePending!: () => void;
  const pending = new Promise<void>((resolve) => { releasePending = resolve; });
  await page.route("**/api/notebooks/*/notes/order", async (route) => {
    await pending;
    await route.continue();
  });
  const reorderRequest = page.waitForRequest((request) => request.url().endsWith(`/api/notebooks/${notebookId}/notes/order`));
  await expect(handle).toBeEnabled();
  await handle.press("Alt+ArrowUp");
  await reorderRequest;
  const search = page.getByRole("searchbox", { name: "全局搜索", exact: true });
  await search.click();
  releasePending();
  await expect.poll(async () => (await readTree()).map((note) => note.id)).toEqual([first, third, second]);
  await expect(search).toBeFocused();
  await page.unroute("**/api/notebooks/*/notes/order");

  await page.reload();
  await expect(main.locator('.document-main-item[data-parent-id="root"] > .document-main-row a').first()).toContainText("第一篇");

  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    storageState: await page.context().storageState(),
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto(`/documents/${first}`);
  await touchPage.getByRole("button", { name: "打开主导航", exact: true }).click();
  const touchSidebar = touchPage.getByRole("navigation", { name: "笔记本文档" });
  await touchSidebar.getByRole("button", { name: `文档操作 ${childTitle}`, exact: true }).click();
  await touchPage.getByRole("menuitem", { name: "重命名", exact: true }).click();
  const renameDialog = touchPage.getByRole("dialog", { name: "重命名文档", exact: true });
  await expect(renameDialog.getByLabel("文档标题")).toBeFocused();
  expect.soft(await renameDialog.evaluate((element) => {
    const modal = element.closest('.orbis-modal-backdrop')!;
    const navigation = document.querySelector('.workspace-main-navigation')!;
    return Number(getComputedStyle(modal).zIndex) > Number(getComputedStyle(navigation).zIndex);
  })).toBe(true);
  expect(await renameDialog.getByLabel("文档标题").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
  })).toBe(true);
  await renameDialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(renameDialog).toHaveCount(0);
  const siblingRows = touchSidebar.locator(`.document-context-item[data-parent-id="${first}"] > .document-context-row`);
  await expect(siblingRows).toHaveCount(2);
  for (const row of await siblingRows.all()) {
    const layout = await row.evaluate((element) => {
      const line = element.getBoundingClientRect();
      const title = element.querySelector("a")!.getBoundingClientRect();
      const buttons = element.querySelector(".document-context-actions")!.getBoundingClientRect();
      return { overlap: title.left < buttons.right && title.right > buttons.left && title.top < buttons.bottom && title.bottom > buttons.top, outside: buttons.top < line.top || buttons.bottom > line.bottom };
    });
    expect(layout.overlap).toBe(false);
    expect(layout.outside).toBe(false);
  }
  const touchHandle = touchSidebar.getByRole("button", { name: "拖动排序 第一篇的另一篇子文档", exact: true });
  const touchTarget = touchSidebar.getByRole("button", { name: `拖动排序 ${childTitle}`, exact: true });
  await expect.poll(async () => Math.round((await touchPage.locator(".workspace-main-navigation").boundingBox())!.x)).toBe(6);
  await touchHandle.scrollIntoViewIfNeeded();
  await expect(touchHandle).toHaveAttribute("aria-roledescription", "draggable");
  const touchStart = (await touchHandle.boundingBox())!;
  const touchEnd = (await touchTarget.boundingBox())!;
  const touchX = touchStart.x + touchStart.width / 2;
  const touchY = touchStart.y + touchStart.height / 2;
  const targetY = touchEnd.y + 3;
  await expect.poll(() => touchPage.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"), { x: touchX, y: touchY })).toBe("拖动排序 第一篇的另一篇子文档");
  const touchSession = await touchContext.newCDPSession(touchPage);
  await touchSession.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchX, y: touchY }] });
  await touchPage.waitForTimeout(300); // Hold long enough to activate the touch drag without scrolling.
  await expect(touchHandle).toHaveAttribute("aria-grabbed", "true");
  for (let step = 1; step <= 16; step += 1) {
    await touchSession.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchX, y: touchY + (targetY - touchY) * step / 16 }] });
    await touchPage.waitForTimeout(16);
  }
  await touchPage.waitForTimeout(100); // The collision update runs on the next animation frame.
  await touchSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => (await readTree())[0].children.map((note) => note.id)).toEqual([secondChild, child]);
  await touchContext.close();
});
