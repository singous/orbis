import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
const mobileViewport = { width: 390, height: 844 };

async function signIn(page: Page, request: APIRequestContext) {
  const setup = await request.post("/api/setup", { data: { ...owner, display_name: "控件回归验收" } });
  expect([201, 409]).toContain(setup.status());
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
}

test("mobile navigation covers its dismiss area and restores focus after an outside click", async ({ page, request }) => {
  await signIn(page, request);
  await page.setViewportSize(mobileViewport);
  const trigger = page.getByRole("button", { name: "打开主导航", exact: true });
  await trigger.click();
  const backdrop = page.getByRole("button", { name: "关闭主导航", exact: true });
  const bounds = await backdrop.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBe(mobileViewport.width);
  expect(bounds!.y + bounds!.height).toBe(mobileViewport.height);
  await page.mouse.click(mobileViewport.width - 10, 500);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
});

test("desktop search launchers fit their container and group headings stay left aligned", async ({ page, request }) => {
  await page.addInitScript(() => Object.assign(window, { __ORBIS_HOST__: { surface: "desktop" } }));
  await signIn(page, request);
  for (const width of [1440, mobileViewport.width]) {
    await page.setViewportSize({ width, height: 1000 });
    const metrics = await page.getByRole("button", { name: "全局搜索", exact: true }).evaluate((button) => {
      const outer = button.getBoundingClientRect();
      const label = button.querySelector("span")!.getBoundingClientRect();
      const container = button.closest(".workspace-topbar-center")!.getBoundingClientRect();
      return { top: label.top - outer.top, bottom: outer.bottom - label.bottom, right: outer.right - container.right, labelRight: label.right - outer.right };
    });
    expect(metrics.top).toBeGreaterThanOrEqual(0);
    expect(metrics.bottom).toBeGreaterThanOrEqual(0);
    expect(metrics.right).toBeLessThanOrEqual(1);
    expect(metrics.labelRight).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/documents/collections");
  const group = page.getByRole("button", { name: /收起分组 默认分组/ });
  const inset = await group.evaluate((button) => button.querySelector(".workbench-group-name")!.getBoundingClientRect().left - button.getBoundingClientRect().left);
  expect(inset).toBeLessThan(50);
});

test("long document excerpts wrap without horizontal overflow in site configuration", async ({ page, request }) => {
  await signIn(page, request);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
  const headers = { Authorization: `Bearer ${token}` };
  const notebookResponse = await request.post("/api/notebooks", { headers, data: { title: "长内容回归", sort_order: 0 } });
  expect(notebookResponse.status()).toBe(201);
  const notebookId = (await notebookResponse.json()).data.id as string;
  const imported = await request.post("/api/notes/import/markdown", { headers, data: {
    notebook_id: notebookId,
    title: "文档的长标题需要在狭窄的站点配置区域中保持完整可读",
    markdown: "这是用于验证文档选择列表能够正常换行的中文内容，按钮应根据内容自动增长并保持图标对齐。".repeat(5),
  } });
  expect(imported.status()).toBe(201);
  const siteResponse = await request.post("/api/sites", { headers, data: {
    name: "控件回归站点", slug: `control-layout-${Date.now()}`, description: "", site_kind: "knowledge", accent_color: "#0f766e", navigation: [],
    source: { kind: "manual", notebooks: [], excluded_note_ids: [], page_overrides: [] },
  } });
  expect(siteResponse.status()).toBe(201);
  const siteId = (await siteResponse.json()).data.id as string;
  for (const width of [1440, mobileViewport.width]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/sites/${siteId}`);
    await expect(page.locator(".site-picker-results > button").first()).toBeVisible();
    const geometry = await page.locator(".workspace-content").evaluate((content) => ({
      client: content.clientWidth, scroll: content.scrollWidth,
      rows: Array.from(content.querySelectorAll(".site-picker-results > button")).map((row) => ({
        height: row.getBoundingClientRect().height,
        contentHeight: row.querySelector("span")!.getBoundingClientRect().height,
        padding: parseFloat(getComputedStyle(row).paddingTop) + parseFloat(getComputedStyle(row).paddingBottom),
      })),
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    for (const row of geometry.rows) expect(row.height).toBeGreaterThanOrEqual(row.contentHeight + row.padding);
  }
});

test("account menu links preserve modified-click navigation", async ({ page, context, request }) => {
  await signIn(page, request);
  await page.getByRole("button", { name: "打开用户菜单", exact: true }).click();
  const account = page.getByRole("menuitem", { name: "账号", exact: true });
  await expect(account).toHaveAttribute("href", "/settings/account");
  const newPage = context.waitForEvent("page");
  await account.click({ modifiers: ["ControlOrMeta"] });
  const opened = await newPage;
  await expect(opened).toHaveURL(/\/settings\/account$/);
  await expect(page).toHaveURL(/\/documents$/);
  await opened.close();
});
