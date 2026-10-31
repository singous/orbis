import { expect, test } from "@playwright/test";
import { openWithSession, ownerSession } from "../helpers/api-fixtures";

test("cold startup reserves workspace geometry and later routes preserve the mounted navigation", async ({ page, request }, testInfo) => {
  const session = await ownerSession(request);
  let releaseStartup!: () => void;
  const startup = new Promise<void>(resolve => { releaseStartup = resolve; });
  await page.route(/\/assets\/WorkspaceRoute-[^/]+\.js$/, async route => { await startup; await route.continue(); });
  const opening = openWithSession(page, session, "/home");
  try {
    const placeholder = page.locator(".workspace-startup");
    await expect(placeholder.getByRole("status", { name: "正在打开首页…" })).toBeVisible();
    await expect(placeholder.locator(".workspace-main-navigation")).toBeVisible();
    await expect(placeholder.locator(".workspace-sidebar")).toHaveCount(0);
    await expect(placeholder.locator(".workspace-startup-toolbar")).not.toBeVisible();
    const content = await placeholder.locator(".home-page").boundingBox();
    expect(content!.x).toBeGreaterThan(50);
    await expect(placeholder.locator(".home-grid > .home-card")).toHaveCount(4);
    expect(await placeholder.locator(".home-grid").evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(2);
    await page.screenshot({ path: testInfo.outputPath("startup-desktop.png"), animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(placeholder.locator(".workspace-startup-toolbar")).toBeVisible();
    expect(await placeholder.locator(".home-grid").evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await placeholder.locator(".skeleton").first().evaluate(node => getComputedStyle(node).animationName)).toBe("none");
    await page.screenshot({ path: testInfo.outputPath("startup-mobile.png"), animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 1000 });
  } finally { releaseStartup(); }
  await opening;
  await expect(page.locator(".workspace-startup")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "首页", exact: true })).toBeVisible();
  const navigation = page.locator(".workspace-main-navigation");
  await navigation.evaluate(node => node.setAttribute("data-instance", "retained"));
  let releasePage!: () => void;
  const destination = new Promise<void>(resolve => { releasePage = resolve; });
  await page.route(/\/assets\/DocumentOverviewPage-[^/]+\.js$/, async route => { await destination; await route.continue(); });
  try {
    await page.getByRole("link", { name: "在线文档", exact: true }).click();
    await expect(page.getByRole("status", { name: "正在打开在线文档…" })).toBeVisible();
    await expect(navigation).toHaveAttribute("data-instance", "retained");
    await expect(page.getByRole("navigation", { name: "文档导航" })).toBeVisible();
    await expect(page.locator(".loading-layout--editor")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("route-loading.png"), animations: "disabled" });
  } finally { releasePage(); }
  await expect(page.getByRole("status", { name: "正在打开在线文档…" })).toHaveCount(0);
  await expect(navigation).toHaveAttribute("data-instance", "retained");
});
