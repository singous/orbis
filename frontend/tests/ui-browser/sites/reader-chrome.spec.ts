import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { manifest, publishedPages, readerHTTP, releaseId, siteId, user, workspace } from "../fixtures/site-reader";

for (const inner of ["light", "dark"] as const) for (const width of [1280, 390]) {
  test.describe(`${inner} ${width}px reader`, () => {
    test.use({ hasTouch: width === 390 });
    test("reader chrome preserves nested theme, layout, navigation and accessibility", async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(({ inner }) => { localStorage.setItem("orbis.appearance", inner === "light" ? "dark" : "light"); localStorage.setItem("orbis-reader-theme", inner); }, { inner });
      const requests = await readerHTTP(page, baseURL);
      await page.goto("/s/guide");
      await expect(page.getByText("当前页面正文", { exact: true })).toBeVisible();
      await expect(page.locator(".site-reader")).toHaveAttribute("data-theme", inner);
      expect(requests).toContain("/src/features/sites/PublicSitePage.tsx");
      expect(requests).not.toContain("/src/features/sites/SitePreviewPage.tsx");
      expect(await page.locator(".site-reader-header-main").evaluate(el => el.getBoundingClientRect().height)).toBe(width === 1280 ? 70 : 62);
      expect(await page.locator(".site-reader-layout").evaluate(el => getComputedStyle(el).display)).toBe(width === 1280 ? "grid" : "block");
      await expect(page.getByRole("navigation", { name: "相邻文档" }).getByRole("link")).toHaveAttribute("href", "/s/guide/guides/install");
      await expect(page.locator(".site-reader-page-footer")).toHaveText("最后更新于 1970年1月1日");
      if (width === 1280) {
        expect(await page.locator(".site-reader-copy-actions button").first().evaluate(el => el.getBoundingClientRect().width)).toBe(92);
        await expect(page.locator(".site-reader-outline")).toBeVisible();
        await expect(page.getByRole("link", { name: "产品首页" })).toBeVisible();
        await expect(page.getByRole("link", { name: "源码与许可" })).toHaveAttribute("href", "/licenses/");
        await expect(page.getByRole("link", { name: "源码与许可" })).toBeInViewport();
      } else {
        await expect(page.locator(".site-reader-mobile-outline")).toBeVisible();
        const toggle = page.getByRole("button", { name: "打开站点导航" });
        expect((await toggle.boundingBox())?.width).toBe(44);
        expect((await toggle.boundingBox())?.height).toBe(44);
        await toggle.click();
        const drawer = page.getByRole("dialog", { name: "站点导航抽屉" });
        await expect(drawer).toBeVisible();
        const license = drawer.getByRole("link", { name: "源码与许可" });
        await expect(license).toHaveAttribute("href", "/licenses/");
        await expect(license).toBeInViewport();
        expect((await license.boundingBox())?.height).toBe(44);
        await expect(drawer.locator("summary")).toBeFocused();
        await page.keyboard.press("Space");
        await expect(drawer.getByRole("link", { name: "安装指南" })).toBeHidden();
        await expect(drawer.getByRole("link", { name: "快速开始" })).toBeVisible();
        await page.keyboard.press("Space");
        await expect(drawer.getByRole("link", { name: "安装指南" })).toBeVisible();
        await page.keyboard.press("Shift+Tab");
        await expect(drawer.getByRole("link", { name: "源码与许可" })).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(drawer.locator("summary")).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveCount(0);
        await expect(toggle).toBeFocused();
        expect(await page.locator("body").evaluate(el => el.style.overflow)).toBe("");
      }
      if (width === 390) await page.locator(".site-reader-mobile-outline summary").click();
      await expect(page.getByRole("navigation", { name: "本页目录" }).getByRole("link", { name: "开始阅读" })).toHaveAttribute("href", "#heading-0");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect((await new AxeBuilder({ page }).include(".site-reader").analyze()).violations).toEqual([]);
      await page.getByRole("button", { name: "搜索文档 ⌘ K", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "搜索文档", exact: true });
      expect((await dialog.boundingBox())?.width).toBe(width === 1280 ? 660 : 366);
      const input = dialog.getByRole("combobox");
      await expect(input).toBeFocused();
      await input.fill("安装");
      await expect(dialog.getByRole("option")).toHaveCount(2);
      await page.keyboard.press("ArrowDown");
      await expect(input).toHaveAttribute("aria-activedescendant", "site-search-1");
      await page.keyboard.press("ArrowUp");
      await expect(input).toHaveAttribute("aria-activedescendant", "site-search-0");
      await expect(input).toBeFocused();
      expect((await new AxeBuilder({ page }).include(".site-reader-search-dialog").analyze()).violations).toEqual([]);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/s\/guide\/guides\/install$/);
      await expect(page.getByText("安装专用正文", { exact: true })).toBeVisible();
      await expect(dialog).toHaveCount(0);
    });

    test("authenticated preview and unavailable status retain their route-owned chrome", async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(({ inner, user, workspace }) => {
        localStorage.setItem("orbis.appearance", inner === "light" ? "dark" : "light");
        localStorage.setItem("orbis-reader-theme", inner);
        localStorage.setItem("orbis.auth.v2", JSON.stringify({ user, workspace, accessToken: "reader-ui", refreshToken: "refresh", credentialID: "reader-ui" }));
      }, { inner, user, workspace });
      const requests = await readerHTTP(page, baseURL);
      await page.goto(`/sites/${siteId}/preview`);
      await expect(page.getByText("当前页面正文", { exact: true })).toBeVisible();
      expect(requests).toContain("/src/features/sites/SitePreviewPage.tsx");
      expect(requests.some(path => path.startsWith("/api/v1/public/sites/"))).toBe(false);
      await expect(page.getByRole("link", { name: "← 返回发布管理" })).toHaveAttribute("href", `/sites/${siteId}`);
      await expect(page.locator(".site-reader-preview-banner")).toHaveText("发布预览 · 此页面只有工作空间成员可见");
      await expect(page.getByRole("navigation", { name: "相邻文档" }).getByRole("link")).toHaveAttribute("href", `/sites/${siteId}/preview/guides/install`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.route("**/api/v1/public/sites/guide/manifest", route => route.fulfill({ status: 404, json: { code: "SITE_NOT_FOUND", message: "未发布", request_id: "reader-missing", data: null } }));
      await page.goto("/s/guide");
      await expect(page.getByRole("heading", { name: "站点尚未发布或已撤回" })).toBeVisible();
      await expect(page.getByRole("button", { name: "重新加载" })).toBeEnabled();
      expect((await page.locator(".site-reader-status").boundingBox())?.height).toBeGreaterThanOrEqual(630);
      expect((await new AxeBuilder({ page }).include(".site-reader-status").analyze()).violations).toEqual([]);
    });
  });
}

test("reader search and navigation retain visible focus under forced colors and reduced motion", async ({ page, baseURL }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await readerHTTP(page, baseURL);
  await page.goto("/s/guide");
  await expect(page.getByText("当前页面正文", { exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳转到正文" })).toBeFocused();
  expect(await page.getByRole("link", { name: "跳转到正文" }).evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "搜索文档" });
  await expect(dialog.getByRole("combobox")).toBeFocused();
  expect(await dialog.evaluate(el => Number.parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(0.001);
  expect(await dialog.getByRole("combobox").evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "搜索文档 ⌘ K", exact: true })).toBeFocused();
});

test("public bootstrap retains server content until its entry and reader styles are ready", async ({ page, baseURL }) => {
  const requests = await readerHTTP(page, baseURL);
  let releaseEntry!: () => void;
  let releaseReads!: () => void;
  const entryReady = new Promise<void>(resolve => { releaseEntry = resolve; });
  const readsReady = new Promise<void>(resolve => { releaseReads = resolve; });
  const bootstrapPage = { ...publishedPages[0], blocks: { schema_version: 2, editor: "blocknote", blocks: [{ id: "bootstrap-content", type: "paragraph", props: {}, content: [{ type: "text", text: "当前页面正文" }], children: [] }] } };
  const bootstrap = JSON.stringify({ manifest: { ...manifest, canonical_base_url: "https://docs.example.com/s/guide" }, page: { release_id: releaseId, page: bootstrapPage } });
  await page.route("**/src/features/sites/PublicSitePage.tsx*", async route => { await entryReady; await route.continue(); });
  await page.route("**/api/v1/public/sites/guide/**", async route => { await readsReady; await route.fallback(); });
  await page.route("**/s/guide", async route => {
    const response = await route.fetch({ url: `${baseURL}/login` });
    const html = (await response.text())
      .replace('<div id="root"></div>', '<div id="root"><article data-reader-ssr>服务端保留正文</article></div>')
      .replace("</body>", `<script id="orbis-site-bootstrap" type="application/json">${bootstrap}</script></body>`);
    await route.fulfill({ response, body: html });
  });
  try {
    await page.goto("/s/guide", { waitUntil: "domcontentloaded" });
    await expect.poll(() => requests.includes("/src/features/sites/PublicSitePage.tsx")).toBe(true);
    await expect(page.locator("[data-reader-ssr]")).toBeVisible();
    expect(requests).not.toContain("/src/features/sites/SitePreviewPage.tsx");
    releaseEntry();
    await expect(page.getByText("当前页面正文", { exact: true })).toBeVisible();
    await expect(page.locator("[data-reader-ssr]")).toHaveCount(0);
    await expect(page.locator("#orbis-site-bootstrap")).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://docs.example.com/s/guide/start");
    expect(await page.locator(".site-reader").evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    expect(requests).not.toContain("/src/features/sites/SitePreviewPage.tsx");
    expect(requests.some(path => /^\/api\/v1\/workspaces\/.+\/sites\/.+\/preview$/.test(path))).toBe(false);
  } finally {
    releaseEntry();
    releaseReads();
  }
});

test("preview entry remains behind authentication before its module and API load", async ({ page, baseURL }) => {
  const requests = await readerHTTP(page, baseURL);
  await page.goto(`/sites/${siteId}/preview`);
  await expect(page).toHaveURL(/\/login$/);
  expect(requests).not.toContain("/src/features/sites/SitePreviewPage.tsx");
  expect(requests.some(path => path.endsWith(`/sites/${siteId}/preview`))).toBe(true);
  expect(requests.some(path => path.startsWith("/api/") && path.endsWith(`/sites/${siteId}/preview`))).toBe(false);
});

test("reader follows system media changes independently of the workspace appearance mode", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    localStorage.setItem("orbis.appearance", "light");
    localStorage.setItem("orbis-reader-theme", "system");
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await readerHTTP(page, baseURL);
  await page.goto("/s/guide");
  const reader = page.locator(".site-reader");
  await expect(reader).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(reader).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "当前跟随系统主题，切换为浅色主题" }).click();
  await expect(reader).toHaveAttribute("data-theme-mode", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(reader).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("orbis-reader-theme"))).toBe("light");
  await page.getByRole("button", { name: "切换深色主题" }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(reader).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "切换跟随系统主题" }).click();
  await expect(reader).toHaveAttribute("data-theme-mode", "system");
  await expect(reader).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("orbis-reader-theme"))).toBe("system");
});

test("reader media subscriptions switch live outline and navigation at their inclusive boundaries", async ({ page, baseURL }) => {
  await readerHTTP(page, baseURL);
  await page.setViewportSize({ width: 1181, height: 900 });
  await page.goto("/s/guide");
  await expect(page.getByText("当前页面正文", { exact: true })).toBeVisible();
  await expect(page.locator(".site-reader-outline")).toBeVisible();
  await page.setViewportSize({ width: 1180, height: 900 });
  await expect(page.locator(".site-reader-mobile-outline")).toBeVisible();
  await expect(page.locator(".site-reader-outline")).toHaveCount(0);
  await page.setViewportSize({ width: 801, height: 900 });
  await expect(page.getByRole("button", { name: "打开站点导航" })).toBeHidden();
  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole("button", { name: "打开站点导航" }).click();
  await expect(page.getByRole("dialog", { name: "站点导航抽屉" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "搜索文档 ⌘ K", exact: true }).click();
  const search = page.getByRole("dialog", { name: "搜索文档", exact: true });
  expect((await search.boundingBox())?.y).toBe(12);
  await expect(search.getByRole("listbox", { name: "搜索结果" })).toHaveCSS("max-height", "750px");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1181, height: 900 });
  await expect(page.locator(".site-reader-outline")).toBeVisible();
  await expect(page.locator(".site-reader-mobile-outline")).toHaveCount(0);
});
