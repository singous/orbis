import { expect, test } from "@playwright/test";
import { SIDEBAR_MOTION_DURATION_MS } from "../../../src/features/workspace/workspace-sidebar-config";
import { installSession, pagination, user, workspace } from "../fixtures/session";

for (const surface of ["web", "desktop"] as const) for (const theme of ["light", "dark"] as const) for (const width of [1280, 390]) {
  test(`${surface} ${theme} workspace at ${width}px keeps its navigation tracks and drawers`, async ({ page }) => {
    await installSession(page);
    await page.addInitScript(({ surface, theme }) => {
      localStorage.setItem("orbis.appearance", theme);
      if (surface === "desktop") Object.assign(window, { __ORBIS_HOST__: { surface } });
    }, { surface, theme });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/v1/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const data = path === "/api/v1/me" ? user : path === "/api/v1/workspaces" ? { items: [workspace], pagination } : { items: [], pagination };
      await route.fulfill({ json: { code: "OK", message: "", request_id: "workspace-layout", data } });
    });
    await page.goto("/settings/account");
    await expect(page.getByRole("heading", { name: "个人资料", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".workspace-sidebar")).toHaveCSS("transition-property", "none");
    const navigation = page.locator(".workspace-main-navigation");
    const rail = page.getByRole("complementary", { name: "应用导航", exact: true });
    const main = page.getByRole("region", { name: "主工作区", exact: true });
    if (width === 1280) {
      await expect(navigation).toHaveCSS("width", "284px");
      await expect(rail).toHaveCSS("width", "52px");
      const navBounds = (await navigation.boundingBox())!;
      expect(navBounds.x).toBe(6);
      expect(navBounds.y).toBe(surface === "web" ? 6 : 46);
      expect((await main.boundingBox())!.x).toBe(296);
      await expect(page.locator(".workspace-sidebar-inner")).toHaveCSS("width", "230px");
      const resize = page.getByRole("separator", { name: "调整侧栏宽度" });
      await resize.focus();
      await page.keyboard.press("ArrowRight");
      await expect(resize).toHaveAttribute("aria-valuenow", "248");
      await expect(resize.locator(".workspace-resize-line")).toHaveCSS("opacity", "1");
      await expect(navigation).toHaveCSS("width", "300px");
      await resize.dblclick();
      await expect(navigation).toHaveCSS("width", "284px");
      await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
      await expect(navigation).toHaveCSS("width", "52px");
      await expect(page.locator(".workspace-sidebar")).toHaveAttribute("aria-hidden", "true");
      await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
      await expect(navigation).toHaveCSS("width", "284px");
    } else {
      await expect(navigation).toHaveAttribute("inert", "");
      const opener = page.getByRole("button", { name: "打开主导航", exact: true });
      await opener.click();
      await expect(navigation).toBeVisible();
      await expect(navigation).toHaveCSS("width", "310px");
      const bounds = (await navigation.boundingBox())!;
      expect(bounds.x).toBe(6);
      expect(bounds.y).toBe(surface === "web" ? 0 : 52);
      await expect(page.locator(".workspace-content")).toHaveAttribute("inert", "");
      await expect(page.locator(".workspace-drawer-backdrop")).toHaveCSS("background-color", "rgba(31, 32, 36, 0.25)");
      await page.keyboard.press("Escape");
      await expect(navigation).toHaveAttribute("inert", "");
      await expect(opener).toBeFocused();
    }
    expect(await main.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

test("rail keyboard focus and sidebar motion use their owned contracts", async ({ page }) => {
  await installSession(page);
  await page.route("**/api/v1/**", route => route.fulfill({ json: { code: "OK", message: "", request_id: "workspace-focus", data: route.request().url().endsWith("/me") ? user : { items: [], pagination } } }));
  await page.goto("/settings/account");
  await expect(page.getByRole("heading", { name: "个人资料", exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳转到主内容" })).toBeFocused();
  await page.keyboard.press("Tab");
  const brand = page.getByRole("button", { name: "切换工作空间", exact: true });
  await expect(brand).toBeFocused();
  await expect(brand).toHaveCSS("outline-style", "solid");
  await expect(brand).toHaveCSS("outline-width", "2px");
  await expect(brand).toHaveCSS("outline-offset", "2px");
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await expect(page.locator(".workspace-shell-grid")).toHaveCSS("transition-property", "grid-template-columns");
  await expect(page.locator(".workspace-shell-grid")).toHaveCSS("transition-duration", `${SIDEBAR_MOTION_DURATION_MS / 1000}s`);
  await expect(page.getByRole("button", { name: "展开侧栏", exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".workspace-shell-grid")).toHaveCSS("transition-property", "none");
  await expect(page.locator(".workspace-route-content")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".workspace-sidebar")).toHaveCSS("transition-property", "none");
  await expect(page.locator(".rail-expand-slot")).toHaveCSS("transition-property", "none");
});

test("workspace navigation follows live media changes at its compact boundary", async ({ page }) => {
  await installSession(page);
  await page.route("**/api/v1/**", route => route.fulfill({ json: { code: "OK", message: "", request_id: "workspace-responsive", data: route.request().url().endsWith("/me") ? user : { items: [], pagination } } }));
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/settings/account");
  await expect(page.getByRole("heading", { name: "个人资料", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "收起侧栏", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 767, height: 900 });
  const opener = page.getByRole("button", { name: "打开主导航", exact: true });
  await expect(opener).toBeVisible();
  await opener.click();
  await expect(page.locator(".workspace-main-navigation")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.getByRole("button", { name: "收起侧栏", exact: true })).toBeVisible();
  await expect(opener).toBeHidden();
});
