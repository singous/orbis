import { expect, test } from "@playwright/test";
import { installSession, pagination, user, workspace } from "../ui-browser/fixtures/session";

for (const theme of ["light", "dark"] as const) for (const width of [1280, 390]) {
  test.describe(`${theme} ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    });

    test("authentication", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByLabel("邮箱", { exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect.soft(page).toHaveScreenshot(`authentication-${theme}-${width}.png`);
    });

    test("workspace profile and user menu", async ({ page }) => {
      await installSession(page);
      await page.route("**/api/v1/**", async route => {
        const pathname = new URL(route.request().url()).pathname;
        const data = pathname === "/api/v1/me" ? user : pathname === "/api/v1/workspaces" ? { items: [workspace], pagination: { ...pagination, total: 1 } } : { items: [], pagination };
        await route.fulfill({ json: { code: "OK", message: "", request_id: "visual-fixture", data } });
      });
      await page.goto("/settings/account");
      await expect(page.getByLabel("名称", { exact: true })).toHaveValue(user.display_name!);
      await page.evaluate(() => document.fonts.ready);
      await expect.soft(page).toHaveScreenshot(`profile-${theme}-${width}.png`);
      if (width < 768) await page.getByRole("button", { name: "打开主导航", exact: true }).click();
      await page.getByRole("button", { name: "打开用户菜单", exact: true }).click();
      await expect(page.getByRole("menu", { name: "用户操作", exact: true })).toBeVisible();
      await expect.soft(page).toHaveScreenshot(`user-menu-${theme}-${width}.png`);
    });

    test("nested dialog and select", async ({ page }) => {
      await page.goto("/__ui");
      const section = page.locator(`section[data-theme="${theme}"]`);
      await expect(section.getByRole("button", { name: "编辑分组" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect.soft(section).toHaveScreenshot(`form-${theme}-${width}.png`);
      await section.getByRole("button", { name: "编辑分组" }).click();
      const dialog = page.getByRole("dialog", { name: "编辑分组", exact: true });
      await expect(dialog).toBeVisible();
      await expect.soft(page).toHaveScreenshot(`dialog-${theme}-${width}.png`);
      await dialog.getByRole("combobox", { name: "分组方式", exact: true }).click();
      await expect(page.getByRole("option", { name: "按名称", exact: true })).toBeVisible();
      await expect.soft(page).toHaveScreenshot(`select-${theme}-${width}.png`);
    });
  });
}
