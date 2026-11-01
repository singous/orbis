import { expect, test } from "@playwright/test";

const releaseId = "00000000-0000-4000-8000-000000000001";
const pages = [{ slug: "start", title: "快速开始", group: "指南", parent_slug: null, section: "指南", description: "", updated_at_ms: 1 }, { slug: "guides/install", title: "安装指南", group: "指南", parent_slug: null, section: "指南", description: "", updated_at_ms: 1 }];

for (const inner of ["light", "dark"] as const) {
  test(`public reader search keeps local ${inner} theme, keyboard and published navigation`, async ({ page, baseURL }) => {
    const outer = inner === "light" ? "dark" : "light";
    await page.addInitScript(({ inner, outer }) => { localStorage.setItem("orbis.appearance", outer); localStorage.setItem("orbis-reader-theme", inner); }, { inner, outer });
    // 本用例验证 React 阅读器；文档入口使用 Vite HTML，公开数据使用固定发布版本的 HTTP 响应。
    await page.route("**/s/guide", async route => { await route.fulfill({ response: await route.fetch({ url: `${baseURL}/login` }) }); });
    await page.route("**/api/v1/public/sites/guide/**", async route => {
      const url = new URL(route.request().url());
      let data: unknown;
      if (url.pathname.endsWith("/manifest")) data = { name: "公开手册", slug: "guide", description: "知识指南", site_kind: "handbook", accent_color: "#0f766e", branding: { logo_url: null, links: [], footer_links: [], cta: null, theme: "system" }, redirects: {}, release_id: releaseId, release_number: 1, published_at_ms: 1, pages };
      else if (url.pathname.endsWith("/search")) data = { release_id: releaseId, items: [{ slug: "guides/install", title: "安装指南", plain_text: "安装专用正文" }], pagination: { page: 1, page_size: 100, total: 1 } };
      else {
        const metadata = url.pathname.endsWith("/pages/start") ? pages[0] : pages[1];
        expect(url.searchParams.get("release_id")).toBe(releaseId);
        const text = metadata.slug === "start" ? "当前页面正文" : "安装专用正文";
        data = { ...metadata, plain_text: text, blocks: [{ id: "paragraph", type: "paragraph", props: {}, content: [{ text, marks: [], href: null }], children: [] }] };
      }
      await route.fulfill({ json: { code: "OK", message: "", request_id: "reader-search-ui", data } });
    });
    await page.goto("/s/guide");
    await expect(page.getByText("当前页面正文", { exact: true })).toBeVisible();
    const reader = page.locator(".site-reader");
    await expect(reader).toHaveAttribute("data-theme", inner);
    await expect(page.locator("html")).toHaveAttribute("data-theme", outer);
    await reader.evaluate((element, theme) => {
      const root = element as HTMLElement;
      root.style.setProperty("--ob-font-sans", "Georgia, serif");
      root.style.setProperty("--ob-reader-background", theme === "light" ? "#e8eef4" : "#14202b");
      root.style.setProperty("--ob-reader-surface", theme === "light" ? "#e8eef4" : "#14202b");
      root.style.setProperty("--ob-reader-text", theme === "light" ? "#17324d" : "#e6eef4");
    }, inner);
    const trigger = page.getByRole("button", { name: "搜索文档 ⌘ K", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "搜索文档", exact: true });
    const input = dialog.getByRole("combobox", { name: "搜索文档" });
    await expect(input).toBeFocused();
    expect(await dialog.evaluate(element => element.closest("[data-theme]")?.getAttribute("data-theme"))).toBe(inner);
    expect(await dialog.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(await reader.evaluate(element => getComputedStyle(element).backgroundColor));
    await expect(dialog).toHaveCSS("font-family", await reader.evaluate(element => getComputedStyle(element).fontFamily));
    await expect(input).toHaveCSS("font-family", await reader.evaluate(element => getComputedStyle(element).fontFamily));
    await expect(dialog).toHaveCSS("color", await reader.evaluate(element => getComputedStyle(element).color));
    await reader.evaluate(element => { (element as HTMLElement).style.setProperty("--ob-font-sans", "monospace"); });
    await expect(dialog).toHaveCSS("font-family", await reader.evaluate(element => getComputedStyle(element).fontFamily));
    await input.dispatchEvent("compositionstart", { data: "安" });
    await input.fill("安装");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/s\/guide$/);
    await input.dispatchEvent("compositionend", { data: "安装" });
    const option = dialog.getByRole("option", { name: /安装指南/ });
    await expect(option).toBeVisible();
    expect(await option.evaluate(element => ({ tag: element.tagName, tabIndex: (element as HTMLElement).tabIndex }))).toEqual({ tag: "BUTTON", tabIndex: 0 });
    await expect(option.locator("small")).toHaveText("指南");
    await expect(option.locator("strong mark")).toHaveText("安装");
    await expect(input).toHaveAttribute("aria-controls", "site-reader-search-results");
    await expect(input).toHaveAttribute("aria-activedescendant", await option.getAttribute("id") ?? "");
    await expect(option).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await input.fill("安装");
    await expect(dialog.getByRole("option", { name: /安装指南/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/s\/guide\/guides\/install$/);
    await expect(page.getByText("安装专用正文", { exact: true })).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });
}
