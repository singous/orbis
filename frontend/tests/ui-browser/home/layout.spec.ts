import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectVisibleKeyboardFocus } from "../fixtures/media";

import { installHomeFixture, tag } from "../fixtures/home";

test.beforeEach(async ({ page }) => { await installHomeFixture(page); });

for (const theme of ["light", "dark"]) for (const forcedColors of ["none", "active"] as const) {
  test(`home ${theme} links keep platform keyboard focus with forced colors ${forcedColors}`, async ({ page }, info) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.emulateMedia({ forcedColors });
    await page.goto("/home");
    await expect(page.locator(".home-document-row")).toHaveCount(3);
    await page.keyboard.press("Tab");
    const links = page.locator(".home-stats a, .home-document-row, .home-notebook");
    const metrics = [];
    for (const link of await links.all()) {
      await link.focus();
      await expect(link).toBeFocused();
      const focus = await expectVisibleKeyboardFocus(link);
      metrics.push(focus);
    }
    expect(metrics).toHaveLength(9);
    await info.attach("home-link-focus", { body: JSON.stringify({ theme, forcedColors, links: metrics }, null, 2), contentType: "application/json" });
  });
}

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) {
  test(`home ${theme} at ${width}px keeps panel and editor layout`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/home");
    await expect(page.locator(".home-document-row")).toHaveCount(3);
    const composer = page.getByRole("region", { name: "快速记录" });
    await composer.getByRole("textbox", { name: "随手记正文" }).fill("Home layout draft");
    await composer.getByRole("button", { name: "添加标签", exact: true }).click();
    await page.locator(".quick-note-tag-options").getByRole("button", { name: "设计", exact: true }).click();
    await composer.getByRole("button", { name: "添加标签", exact: true }).click();
    const panels = await page.locator(".home-grid > .home-card").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
    expect(panels).toHaveLength(4);
    if (width === 1280) {
      expect(panels[0].y).toBe(panels[1].y);
      expect(panels[0].height).toBe(panels[1].height);
      expect(panels[1].x - panels[0].right).toBeCloseTo(16, 1);
      expect(panels[2].y).toBe(panels[3].y);
    } else for (let index = 1; index < panels.length; index += 1) expect(panels[index].y - panels[index - 1].bottom).toBeCloseTo(16, 1);
    expect(await composer.locator(".tiptap").evaluate(element => parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThanOrEqual(100);
    await expect(composer.locator(".tiptap")).toHaveCSS("padding", "12px 12px 32px");
    await expect(composer.locator(".quick-note-composer-tags")).toHaveCSS("order", "3");
    await expect(composer.locator(".quick-note-selected-tag")).toContainText("设计");
    expect(await page.locator(".home-page").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (width === 390) await expect(page.locator(".home-welcome-art")).toHaveCSS("width", "128px");
    expect((await new AxeBuilder({ page }).include(".home-page").analyze()).violations).toEqual([]);
  });
}

test("home chrome preserves a local draft, tags, attachment entry and keyboard save", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/home");
  const composer = page.getByRole("region", { name: "快速记录" });
  const editor = composer.getByRole("textbox", { name: "随手记正文" });
  await editor.fill("保留这条首页灵感");
  await composer.getByRole("button", { name: "添加标签", exact: true }).click();
  await page.locator(".quick-note-tag-options").getByRole("button", { name: "设计", exact: true }).click();
  await composer.getByRole("button", { name: "添加标签", exact: true }).click();
  await page.reload();
  await expect(editor).toContainText("保留这条首页灵感");
  await expect(composer.locator(".quick-note-selected-tag")).toContainText("设计");
  const chooser = page.waitForEvent("filechooser");
  await composer.getByRole("button", { name: "添加附件", exact: true }).click();
  await (await chooser).setFiles([]);
  const saving = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/quick-notes"));
  await editor.focus();
  await page.keyboard.press("Control+Enter");
  const body = (await saving).postDataJSON();
  expect(body).toMatchObject({ expected_version: 0, tag_ids: [tag.id], operation_id: expect.any(String) });
  expect(JSON.stringify(body.blocks)).toContain("保留这条首页灵感");
  await expect(editor).toHaveText("");
  await expect(composer.getByText("已记下", { exact: true })).toBeVisible();
});

test("home startup uses the shared responsive panel geometry", async ({ page }) => {
  let releaseModule!: () => void;
  const loading = new Promise<void>(resolve => { releaseModule = resolve; });
  await page.route("**/src/features/home/HomePage.tsx*", async route => { await loading; await route.continue(); });
  const opening = page.goto("/home");
  try {
    const home = page.locator(".workspace-loading-home");
    await expect(home).toBeVisible();
    await expect(home.locator(".home-grid > .home-card")).toHaveCount(4);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await home.locator(".home-grid").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(width === 1280 ? 2 : 1);
      expect(await home.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  } finally { releaseModule(); }
  await opening;
  await expect(page.locator(".home-document-row")).toHaveCount(3);
});

test.describe("home touch scale", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("keeps search and editor dimensions tied to the shared user font scale", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/home");
    await expect(page.locator(".home-document-row")).toHaveCount(3);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.fontSize = "20px"; });
    const search = page.getByRole("searchbox", { name: "搜索文档" });
    expect((await search.boundingBox())!.height).toBeGreaterThanOrEqual(30);
    expect(await search.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    const trigger = page.getByRole("search").getByRole("button", { name: "搜索", exact: true });
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(30);
    expect((await trigger.boundingBox())!.width).toBeGreaterThanOrEqual(30);
    expect(await page.locator(".home-note-field .tiptap").evaluate(element => parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThanOrEqual(180);
    expect(await page.locator(".home-page").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
});
