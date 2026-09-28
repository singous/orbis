import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Headless Chromium hides scrollbars by default; exercise the real draggable thumb.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

async function signIn(page: Page, request: APIRequestContext) {
  const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
  const setup = await request.post("/api/setup", { data: { ...owner, display_name: "滚动与图标验收" } });
  expect([201, 409]).toContain(setup.status());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await page.goto("/home");
}

test("the global scrollbar skin preserves wheel and keyboard scrolling", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await signIn(page, request);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
  const headers = { Authorization: `Bearer ${token}` };
  const notebook = await request.post("/api/notebooks", { headers, data: { title: "滚动验收笔记本" } });
  expect(notebook.status()).toBe(201);
  const notebookId = (await notebook.json()).data.id;
  for (let index = 0; index < 5; index++) {
    const created = await request.post("/api/notes", { headers, data: { notebook_id: notebookId, title: `滚动验收文档 ${index + 1}` } });
    expect(created.status()).toBe(201);
  }
  await page.reload();
  const scroller = page.locator(".workspace-content");
  await expect.poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
  const skin = await scroller.evaluate((element) => ({
    width: getComputedStyle(element, "::-webkit-scrollbar").width,
    radius: getComputedStyle(element, "::-webkit-scrollbar-thumb").borderRadius,
    track: getComputedStyle(element, "::-webkit-scrollbar-track").backgroundColor,
    arrows: getComputedStyle(element, "::-webkit-scrollbar-button").display,
  }));
  expect(skin.width).toBe("8px");
  expect(skin.radius).toBe("999px");
  expect(skin.track).toBe("rgba(0, 0, 0, 0)");
  expect(skin.arrows).toBe("none");
  const bounds = (await scroller.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 360);
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  await page.getByRole("link", { name: "新建笔记本", exact: true }).focus();
  const before = await scroller.evaluate((element) => element.scrollTop);
  await page.keyboard.press("PageDown");
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);
  await page.getByRole("link", { name: "新建笔记本", exact: true }).focus();
  await page.keyboard.press("Home");
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
  const thumbHeight = await scroller.evaluate((element) => Math.max(32, element.clientHeight * element.clientHeight / element.scrollHeight));
  await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + thumbHeight / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + thumbHeight / 2 + 100, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  await page.screenshot({ path: testInfo.outputPath("themed-scrollbar.png") });
});

test("the temporary document home keeps navigation neutral and selected icons filled", async ({ page, request }, testInfo) => {
  await signIn(page, request);
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.getByRole("heading", { name: "文档概览", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "首页导航", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "业务板块" }).getByRole("link", { name: "首页", exact: true })).toHaveCount(0);
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((mode) => { document.documentElement.dataset.theme = mode; }, theme);
    const selectedGlyphs = page.locator(".rail-action.is-active > svg > .orbis-icon-solid, .workspace-function-link.is-active > svg > .orbis-icon-solid");
    expect(await selectedGlyphs.count()).toBe(2);
    expect(await selectedGlyphs.evaluateAll(glyphs => glyphs.every(glyph => getComputedStyle(glyph).display !== "none" && getComputedStyle(glyph).fillRule === "evenodd"))).toBe(true);
    const inactiveGlyphs = page.locator(".rail-action:not(.is-active) > svg > .orbis-icon-solid");
    expect(await inactiveGlyphs.evaluateAll(glyphs => glyphs.every(glyph => getComputedStyle(glyph).display === "none"))).toBe(true);
    const navigation = await page.locator(".rail-action .orbis-icon, .workspace-function-link .orbis-icon, .workspace-header .orbis-icon").evaluateAll((icons) => icons.map((icon) => ({
      color: getComputedStyle(icon).color,
      stroke: getComputedStyle(icon).strokeWidth,
      inherited: getComputedStyle(icon.parentElement!).color,
      background: getComputedStyle(icon.parentElement!).backgroundImage,
    })));
    expect(navigation.length).toBeGreaterThan(5);
    expect(navigation.every(icon => icon.stroke === "1.8px")).toBe(true);
    await expect.poll(() => page.locator(".rail-action .orbis-icon, .workspace-function-link .orbis-icon, .workspace-header .orbis-icon").evaluateAll((icons) => icons.filter((icon) => getComputedStyle(icon).color !== getComputedStyle(icon.parentElement!).color).length)).toBe(0);
    expect(navigation.every((icon) => icon.background === "none")).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`document-home-icons-${theme}.png`) });
  }
  expect(await page.locator('.rail-action.is-active > svg').evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("link", { name: "站点", exact: true }).click();
  const selectedSiteIcon = page.locator('.rail-action[aria-label="站点"] > svg');
  await expect(page.locator('.rail-action[aria-label="站点"]')).toHaveAttribute("aria-current", "page");
  await expect.poll(() => selectedSiteIcon.evaluate(element => ({ name: getComputedStyle(element).animationName, duration: getComputedStyle(element).animationDuration }))).toEqual({ name: "navigation-icon-select", duration: "0.24s" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => selectedSiteIcon.evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await page.goto("/documents/search");
  await expect(page.getByRole("link", { name: "搜索", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator('.rail-action[aria-label="搜索"] .orbis-icon-solid')).toBeVisible();
  await page.goto("/sites");
  await expect(page.locator('.rail-action[aria-label="搜索"]')).not.toHaveAttribute("aria-current", "page");
  await expect(page.locator('.rail-action[aria-label="搜索"] .orbis-icon-solid')).toBeHidden();
  await page.getByRole("button", { name: "创建站点", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建文档站点", exact: true });
  expect(await dialog.evaluate((element) => getComputedStyle(element, "::-webkit-scrollbar").width)).toBe("8px");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto("/documents/collections");
  await page.getByRole("button", { name: "新建笔记本", exact: true }).click();
  const notebookDialog = page.getByRole("dialog", { name: "新建笔记本", exact: true });
  const swatches = notebookDialog.locator(".notebook-icon-swatch");
  await expect(swatches).toHaveCount(7);
  expect(new Set(await swatches.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundColor))).size).toBe(7);
  await notebookDialog.getByRole("button", { name: "取消", exact: true }).click();

});
