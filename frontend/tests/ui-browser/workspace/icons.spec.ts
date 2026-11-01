import { expect, test } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { installSession, pagination, user, workspace } from "../fixtures/session";

for (const theme of ["light", "dark"]) test(`navigation icons retain their states and motion in ${theme}`, async ({ page }) => {
  await installSession(page);
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  await page.route("**/api/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === "/api/v1/me" ? user : path === "/api/v1/workspaces" ? { items: [workspace], pagination } : { items: [], pagination };
    return route.fulfill({ json: { code: "OK", message: "", request_id: "navigation-icons", data } });
  });
  await page.goto("/settings/account");
  await expect(page.getByRole("heading", { name: "个人资料", exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const state of ["settings", "home", "pressed", "reduced"] as const) {
    const home = page.locator(".workspace-business-rail").getByRole("link", { name: "首页", exact: true });
    if (state === "home") {
      await home.click();
      await expect(page.getByRole("heading", { name: "首页", exact: true })).toBeVisible();
      await expect(home.locator(".orbis-icon")).toHaveCSS("animation-name", "navigation-icon-select");
    }
    if (state === "pressed") {
      await home.hover();
      await page.mouse.down();
      await expect(home.locator(".orbis-icon")).toHaveCSS("transform", "matrix(0.9, 0, 0, 0.9, 0, 0)");
    }
    if (state === "reduced") {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(home.locator(".orbis-icon")).toHaveCSS("animation-name", "none");
      await expect(home.locator(".orbis-icon")).toHaveCSS("transform", "none");
    }
    await page.locator(".workspace-shell").evaluate(element => {
      for (const animation of element.getAnimations({ subtree: true })) {
        if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
      }
    });
    const values = await page.locator(".rail-action>.orbis-icon,.workspace-function-link>.orbis-icon,.workspace-header .orbis-icon").evaluateAll(icons => icons.map(icon => {
      const css = getComputedStyle(icon), box = icon.getBoundingClientRect();
      return { name: icon.getAttribute("data-orbis-icon"), current: icon.parentElement!.getAttribute("aria-current"), width: box.width, height: box.height, display: css.display, flexShrink: css.flexShrink, verticalAlign: css.verticalAlign, pointerEvents: css.pointerEvents, color: css.color, parentColor: getComputedStyle(icon.parentElement!).color, transform: css.transform, transformOrigin: css.transformOrigin, animation: css.animation, children: Array.from(icon.children).map(child => ({ tag: child.tagName, display: getComputedStyle(child).display, fill: getComputedStyle(child).fill, fillRule: getComputedStyle(child).fillRule, stroke: getComputedStyle(child).stroke })) };
    }));
    expect(values.length).toBeGreaterThan(3);
    for (const icon of values) {
      expect(icon.pointerEvents).toBe("none");
      expect(icon.color).toBe(icon.parentColor);
    }
    const activeSolid = home.locator(".orbis-icon-solid");
    await expect(activeSolid).toHaveCSS("display", state === "settings" ? "none" : "block");
    if (process.env.ORBIS_ICON_EVIDENCE) appendFileSync(process.env.ORBIS_ICON_EVIDENCE, JSON.stringify({ theme, state, values }) + "\n");
  }
  await page.mouse.up();
});
