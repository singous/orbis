import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { installSession, pagination, user, workspace } from "../fixtures/session";

async function expectInViewport(page: Page, popup: Locator) {
  await expect(popup).toBeVisible();
  const bounds = (await popup.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
}
for (const surface of ["web", "desktop"] as const) {
  test(`${surface} workspace overlays retain placement, focus and appearance`, async ({ page }) => {
    await installSession(page);
    if (surface === "desktop") await page.addInitScript(() => Object.assign(window, { __ORBIS_HOST__: { surface: "desktop" } }));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/v1/**", async route => {
      const url = new URL(route.request().url());
      let data: unknown = { items: [], pagination };
      if (url.pathname === "/api/v1/me") data = user;
      if (url.pathname === "/api/v1/workspaces") data = { items: [workspace], pagination: { ...pagination, total: 1 } };
      await route.fulfill({ json: { code: "OK", message: "", request_id: "workspace-overlay-test", data } });
    });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/settings/account");
      await expect(page.getByRole("heading", { name: "个人资料", exact: true })).toBeVisible();
      const drawer = page.getByRole("button", { name: "打开主导航", exact: true });
      if (surface === "web" && width < 768) await drawer.click();
      const workspaceTrigger = page.getByRole("button", { name: "切换工作空间", exact: true });
      await workspaceTrigger.click();
      const choices = page.getByRole("dialog", { name: "切换工作空间", exact: true });
      await expectInViewport(page, choices);
      await expect(choices.getByRole("button", { name: `切换到 ${workspace.name}` })).toHaveAttribute("aria-current", "true");
      await page.keyboard.press("Escape");
      await expect(choices).toHaveCount(0);
      await expect(workspaceTrigger).toBeFocused();
      const accountTrigger = page.getByRole("button", { name: "打开用户菜单", exact: true });
      await accountTrigger.click();
      const menu = page.getByRole("menu", { name: "用户操作", exact: true });
      await expectInViewport(page, menu);
      await expect(menu.getByRole("menuitem", { name: "账号", exact: true })).toHaveAttribute("href", "/settings/account");
      expect((await new AxeBuilder({ page }).include('[data-slot="ob-dropdown-menu"]').analyze()).violations).toEqual([]);
      await menu.getByRole("menuitem", { name: "外观", exact: true }).click();
      const appearance = page.getByRole("dialog", { name: "外观", exact: true });
      await expectInViewport(page, appearance);
      await appearance.getByRole("radio", { name: "夜间", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      expect(await page.evaluate(() => localStorage.getItem("orbis.appearance"))).toBe("dark");
      expect((await new AxeBuilder({ page }).include('[data-slot="ob-dialog"]').analyze()).violations).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(appearance).toHaveCount(0);
      await expect(accountTrigger).toBeFocused();
      if (surface === "web" && width < 768) await expect(drawer).toHaveAttribute("aria-expanded", "true");
    }
  });
}
