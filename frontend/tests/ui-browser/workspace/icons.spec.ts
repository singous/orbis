import { expect, test } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { expectNoContinuingMotion, expectVisibleKeyboardFocus } from "../fixtures/media";
import { installSession, pagination, user, workspace } from "../fixtures/session";

for (const theme of ["light", "dark"]) test(`navigation icons keep native control hit targets and current-page semantics in ${theme}`, async ({ page }) => {
  await installSession(page);
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === "/api/v1/me" ? user : path === "/api/v1/workspaces" ? { items: [workspace], pagination } : { items: [], pagination };
    return route.fulfill({ json: { code: "OK", message: "", request_id: "navigation-icons", data } });
  });
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "我的文档", exact: true })).toBeVisible();
  const rail = page.getByRole("navigation", { name: "业务板块", exact: true });
  const menu = page.getByRole("navigation", { name: "文档导航", exact: true });
  const home = menu.getByRole("link", { name: "首页", exact: true });
  await home.focus();
  await home.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await expectVisibleKeyboardFocus(home);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "首页", exact: true })).toBeVisible();
  await expect(home).toHaveAttribute("aria-current", "page");
  await expect(rail.getByRole("link")).toHaveCount(1);
  await expect(rail.getByRole("link", { name: "在线文档" })).toHaveAttribute("aria-current", "page");
  expect(await rail.getByRole("link", { name: "首页" }).count()).toBe(0);
  const values = await rail.locator("a").or(home).evaluateAll(links => links.map(link => {
    const box = link.getBoundingClientRect();
    const icon = link.querySelector("svg");
    return { href: link.getAttribute("href"), width: box.width, height: box.height, icon: icon ? { width: icon.getBoundingClientRect().width, height: icon.getBoundingClientRect().height, pointerEvents: getComputedStyle(icon).pointerEvents } : null };
  }));
  expect(values.length).toBeGreaterThan(1);
  for (const value of values) {
    expect(value.width).toBeGreaterThanOrEqual(24);
    expect(value.height).toBeGreaterThanOrEqual(24);
    expect(value.icon).not.toBeNull();
    expect(value.icon!.width).toBeGreaterThan(0);
    expect(value.icon!.height).toBeGreaterThan(0);
    expect(value.icon!.width).toBeLessThanOrEqual(value.width);
    expect(value.icon!.height).toBeLessThanOrEqual(value.height);
    expect(value.icon!.pointerEvents).toBe("none");
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await home.hover();
  await expectNoContinuingMotion(rail);
  if (process.env.ORBIS_ICON_EVIDENCE) appendFileSync(process.env.ORBIS_ICON_EVIDENCE, JSON.stringify({ theme, values }) + "\n");
});
