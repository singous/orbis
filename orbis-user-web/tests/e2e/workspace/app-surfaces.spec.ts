import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });

type Surface = "web" | "desktop";
const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };

async function signIn(page: Page, request: APIRequestContext, surface: Surface) {
  // This verifies an injected host profile, not a packaged desktop binary.
  if (surface === "desktop") await page.addInitScript(() => Object.assign(window, { __ORBIS_HOST__: { surface: "desktop" } }));
  const setup = await request.post("/api/setup", { data: { ...owner, display_name: "宿主界面验收" } });
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
  test(`${surface} uses the shared workspace with its own header, search and account placement`, async ({ page, request }) => {
    await signIn(page, request, surface);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/documents");
      const shell = page.locator(".workspace-shell");
      const topbar = page.locator(".workspace-topbar");
      await expect(shell).toHaveAttribute("data-app-surface", surface);
      await expect(page.locator(".workspace-user-trigger")).toHaveCount(1);
      await expect(page.locator(".workspace-switcher")).toHaveCount(1);
      if (surface === "web") {
        await expect(topbar).toHaveCount(0);
        await expect(page.getByRole("searchbox", { name: "全局搜索", exact: true })).toHaveCount(0);
        const geometry = await shell.evaluate(element => {
          const grid = element.querySelector(".workspace-shell-grid")!.getBoundingClientRect();
          const box = element.getBoundingClientRect();
          const area = element.querySelector(".workspace-main-area")!.getBoundingClientRect();
          return { shellTop: box.top, shellHeight: box.height, gridTop: grid.top, gridHeight: grid.height, areaTop: area.top, gutter: parseFloat(getComputedStyle(element).getPropertyValue("--shell-gutter")) };
        });
        expect(geometry.gridTop).toBeCloseTo(geometry.shellTop, 0);
        expect(geometry.gridHeight).toBeCloseTo(geometry.shellHeight, 0);
        expect(geometry.areaTop - geometry.shellTop).toBeLessThanOrEqual(geometry.gutter + 1);
      } else {
        await expect(topbar).toBeVisible();
        await expect(topbar.getByRole("button", { name: "切换工作空间", exact: true })).toBeVisible();
        await expect(topbar.getByRole("button", { name: "打开用户菜单", exact: true })).toBeVisible();
        await expect(topbar.getByRole("button", { name: "全局搜索", exact: true })).toBeVisible();
        if (width >= 768) {
          await expect(topbar.getByRole("button", { name: "返回上一页", exact: true })).toBeVisible();
          await expect(topbar.getByRole("button", { name: "前往下一页", exact: true })).toBeVisible();
        }
        const layout = await shell.evaluate(element => ({
          headerHeight: element.querySelector(".workspace-topbar")!.getBoundingClientRect().height,
          gridTop: element.querySelector(".workspace-shell-grid")!.getBoundingClientRect().top - element.getBoundingClientRect().top,
        }));
        expect(layout.gridTop).toBeCloseTo(layout.headerHeight, 0);
        await expect(page.locator(".workspace-business-rail .workspace-user-trigger")).toHaveCount(0);
      }

      const drawer = page.getByRole("button", { name: "打开主导航", exact: true });
      if (surface === "web" && width < 768) await drawer.click();
      const workspaceTrigger = page.getByRole("button", { name: "切换工作空间", exact: true });
      if (surface === "web") await expect(workspaceTrigger).toHaveClass(/workspace-switcher-rail-trigger/);
      await workspaceTrigger.click();
      const details = page.getByRole("dialog", { name: "切换工作空间", exact: true });
      await expectInsideViewport(page, details);
      await page.keyboard.press("Escape");
      await expect(details).toHaveCount(0);
      await expect(workspaceTrigger).toBeFocused();
      if (surface === "web" && width < 768) await expect(drawer).toHaveAttribute("aria-expanded", "true");

      const accountTrigger = page.getByRole("button", { name: "打开用户菜单", exact: true });
      if (surface === "web") {
        await expect(accountTrigger).toHaveClass(/workspace-user-trigger--rail/);
        expect(await accountTrigger.evaluate(element => Boolean(element.closest(".rail-bottom")))).toBe(true);
      }
      await accountTrigger.click();
      const menu = page.locator(".workspace-user-popover [role=menu]");
      await expectInsideViewport(page, page.locator(".workspace-user-popover"));
      await expect(menu.getByRole("menuitem", { name: "账号", exact: true })).toHaveAttribute("href", "/settings/account");
      await expect(menu.getByRole("menuitem", { name: "工作空间成员", exact: true })).toHaveAttribute("href", "/settings/members");
      await expect(menu.getByRole("menuitem", { name: "退出登录", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(accountTrigger).toBeFocused();
      if (surface === "web" && width < 768) {
        await expect(drawer).toHaveAttribute("aria-expanded", "true");
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveAttribute("aria-expanded", "false");
        await expect(drawer).toBeFocused();
      }

      await page.keyboard.press("ControlOrMeta+k");
      const palette = page.getByRole("dialog", { name: "全局搜索", exact: true });
      await expect(palette).toBeVisible();
      await expect(palette.getByRole("combobox", { name: "搜索任何内容", exact: true })).toBeFocused();
      await expect(page).toHaveURL(/\/documents$/);
      await page.keyboard.press("Escape");
      await expect(palette).toHaveCount(0);
      if (surface === "desktop") {
        await topbar.getByRole("button", { name: "全局搜索", exact: true }).click();
        await expect(palette).toBeVisible();
        await expect(page).toHaveURL(/\/documents$/);
        await page.keyboard.press("Escape");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

      await page.goto("/documents");
      if (width < 768) await drawer.click();
      const railSearch = page.getByRole("complementary", { name: "应用导航", exact: true }).getByRole("button", { name: "搜索", exact: true });
      await railSearch.click();
      await expect(palette).toBeVisible();
      await expect(page).toHaveURL(/\/documents$/);
      await page.keyboard.press("Tab");
      expect(await palette.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Escape");
      await expect(palette).toHaveCount(0);
      await expect(railSearch).toBeFocused();
      if (width < 768) {
        await expect(drawer).toHaveAttribute("aria-expanded", "true");
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveAttribute("aria-expanded", "false");
        await expect(drawer).toBeFocused();
      }
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
