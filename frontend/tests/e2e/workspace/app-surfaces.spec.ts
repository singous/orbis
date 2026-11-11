import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });

type Surface = "web" | "desktop";
const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };

async function signIn(page: Page, request: APIRequestContext, surface: Surface) {
  // This verifies an injected host profile, not a packaged desktop binary.
  if (surface === "desktop") await page.addInitScript(() => Object.assign(window, { __ORBIS_HOST__: { surface: "desktop" } }));
  const setup = await request.post("/api/v1/setup", { data: { ...owner,workspace_name:"浏览器测试空间", display_name: "宿主界面验收" } });
  expect([201, 409]).toContain(setup.status());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-app-surface", surface);
}

async function expectInsideViewport(page: Page, overlay: Locator) {
  await expect(overlay).toBeVisible();
  const viewport = page.viewportSize()!;
  const bounds = await overlay.evaluate(element => element.getBoundingClientRect().toJSON());
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(viewport.width);
  expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
}

for (const surface of ["web", "desktop"] as const) {
  test(`${surface} uses the same rail, document menu and account controls`, async ({ page, request }) => {
    await signIn(page, request, surface);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/documents");
      await expect(page.locator(".workspace-shell")).toHaveAttribute("data-app-surface", surface);
      await expect(page.locator(".workspace-topbar")).toHaveCount(0);
      await expect(page.locator(".workspace-user-trigger")).toHaveCount(1);
      await expect(page.locator(".workspace-switcher")).toHaveCount(1);
      const drawer = page.getByRole("button", { name: "打开主导航", exact: true });
      if (width < 768) await drawer.click();
      const rail = page.getByRole("complementary", { name: "应用导航", exact: true });
      const navigation = page.getByRole("navigation", { name: "文档导航", exact: true });
      await expect(rail.getByRole("link", { name: "首页", exact: true })).toHaveCount(0);
      await expect(navigation.getByRole("link", { name: "首页", exact: true })).toHaveAttribute("href", "/home");
      await expect(rail.getByRole("button", { name: "新建资产", exact: true })).toHaveCount(0);

      const workspaceTrigger = rail.getByRole("button", { name: "切换工作空间", exact: true });
      await workspaceTrigger.click();
      const details = page.getByRole("dialog", { name: "切换工作空间", exact: true });
      await expectInsideViewport(page, details);
      await page.keyboard.press("Escape");
      await expect(details).toHaveCount(0);
      await expect(workspaceTrigger).toBeFocused();

      const accountTrigger = rail.getByRole("button", { name: "打开用户菜单", exact: true });
      await accountTrigger.click();
      const menu = page.getByRole("menu", { name: "用户操作", exact: true });
      await expectInsideViewport(page, menu);
      await expect(menu.getByRole("menuitem", { name: "账号", exact: true })).toHaveAttribute("href", "/settings/account");
      await expect(menu.getByRole("menuitem", { name: "工作空间成员", exact: true })).toHaveAttribute("href", "/settings/members");
      await expect(menu.getByRole("menuitem", { name: "退出登录", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(accountTrigger).toBeFocused();

      const search = navigation.getByRole("button", { name: "搜索文档", exact: true });
      await search.click();
      const palette = page.getByRole("dialog", { name: "全局搜索", exact: true });
      await expect(palette.getByRole("combobox", { name: "搜索任何内容", exact: true })).toBeFocused();
      await expect(page).toHaveURL(/\/documents$/);
      await page.keyboard.press("Escape");
      await expect(palette).toHaveCount(0);
      await expect(search).toBeFocused();
      if (width < 768) {
        await expect(drawer).toHaveAttribute("aria-expanded", "true");
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveAttribute("aria-expanded", "false");
        await expect(drawer).toBeFocused();
      }
      await page.keyboard.press("ControlOrMeta+k");
      await expect(palette).toBeVisible();
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  });

  test(`${surface} business icons expose no hover menus and account actions remain available`, async ({ page, request }) => {
    await signIn(page, request, surface);
    const rail = page.getByRole("complementary", { name: "应用导航", exact: true });
    await rail.getByRole("link", { name: "在线文档", exact: true }).hover();
    await page.waitForTimeout(250);
    await expect(page.getByRole("navigation", { name: "笔记本快捷访问", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".workspace-user-trigger")).toHaveCount(1);
    await page.getByRole("button", { name: "打开用户菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "账号", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/account$/);
    await page.getByRole("button", { name: "打开用户菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
}
