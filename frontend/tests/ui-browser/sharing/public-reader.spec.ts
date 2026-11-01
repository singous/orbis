import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { appendFileSync } from "node:fs";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const rootId = id(1), childId = id(2), blockId = id(3), token = "a".repeat(43), now = Date.parse("2026-11-01T00:00:00Z");
const dataPage = (items: unknown[]) => ({ items, pagination: { page: 1, page_size: 20, total: items.length } });
const root = { id: rootId, parent_id: null, title: "公开根文档", position: 0, content_version: 2, updated_at_ms: now };
const child = { ...root, id: childId, parent_id: rootId, title: "子文档" };

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) test.describe(`${theme} ${width}px`, () => {
  test.use({ hasTouch: width === 390 });
  test("anonymous share keeps directory navigation, current content, skip link and failed-read retry", async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    let childUnavailable = true;
    const requests: { path: string; authorization?: string }[] = [];
    await page.route("**/api/v1/**", async route => {
      const request = route.request(), url = new URL(request.url());
      requests.push({ path: url.pathname, authorization: request.headers().authorization });
      let data: unknown = null, status = 200;
      if (url.pathname.endsWith("/directory")) data = { title: "实时团队资料", root_document_id: rootId, directory_version: 7, ...dataPage(url.searchParams.has("parent_id") ? [child] : [root]) };
      else {
        const documentId = url.pathname.includes(childId) ? childId : rootId;
        const document = { id: documentId, title: documentId === rootId ? root.title : child.title, content_version: 2, updated_at_ms: now };
        if (url.pathname.endsWith("/children")) {
          if (documentId === childId && childUnavailable) status = 503;
          data = { document, items: [{ id: blockId, parent_id: null, position: 0, block_type: "paragraph", child_count: 0, payload_loaded: true, payload_bytes: 32, block: { id: blockId, type: "paragraph", props: {}, content: [{ text: "当前公开正文", marks: [], href: null }], children: [] } }], pagination: { next_cursor: null, has_more: false } };
        } else data = document;
      }
      await route.fulfill({ status, json: { code: status === 200 ? "OK" : "UNAVAILABLE", message: status === 200 ? "" : "正文暂时不可用", request_id: "public-sharing-ui", data: status === 200 ? data : null } });
    });
    await page.goto(`/share/${token}`);
    await expect(page.getByRole("heading", { name: root.title })).toBeVisible();
    await expect(page.getByText("当前公开正文")).toBeVisible();
    const license = page.getByRole("link", { name: "源码与许可", exact: true });
    await expect(license).toHaveAttribute("href", "/licenses/");
    await expect(license).toBeInViewport();
    if (width === 390) expect((await license.boundingBox())?.height).toBe(44);
    if (process.env.ORBIS_SURFACE_EVIDENCE) {
      const values = await page.locator(".public-share-reader").evaluate(element => [element, ...element.querySelectorAll("header,aside,main,article,h1,nav a")].map(node => {
        const style = getComputedStyle(node), box = node.getBoundingClientRect();
        return { tag: node.tagName, text: node.textContent?.slice(0, 30), x: box.x, y: box.y, width: box.width, height: box.height, padding: style.padding, color: style.color, background: style.backgroundColor, fontSize: style.fontSize };
      }));
      appendFileSync(process.env.ORBIS_SURFACE_EVIDENCE, JSON.stringify({ state: "public-reader", theme, width, values }) + "\n");
    }
    await page.getByRole("link", { name: "跳转到正文" }).focus();
    await expect(page.getByRole("link", { name: "跳转到正文" })).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#shared-document$/);
    await expect(page.locator("#shared-document")).toBeFocused();
    await page.getByRole("button", { name: `展开${root.title}子目录` }).click();
    await page.getByRole("link", { name: child.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${childId}$`));
    const unavailable = page.getByRole("heading", { name: "暂时无法打开分享" });
    await expect(unavailable).toBeVisible();
    await expect(unavailable).toHaveCSS("font-size", "24px");
    await expect(unavailable).toHaveCSS("font-weight", "600");
    await expect(unavailable.locator("..")).toHaveCSS("padding", "64px 32px");
    expect((await unavailable.locator("..").boundingBox())?.width).toBe(width === 390 ? 390 : 760);
    expect((await new AxeBuilder({ page }).include(".public-share-reader").analyze()).violations).toEqual([]);
    childUnavailable = false;
    await page.getByRole("button", { name: "重新读取", exact: true }).click();
    await expect(page.getByRole("heading", { name: child.title })).toBeVisible();
    await expect(page.getByRole("link", { name: child.title, exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "刷新目录与正文" }).click();
    await expect(page.getByText("当前公开正文")).toBeVisible();
    expect(requests.every(request => request.authorization === undefined)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include(".public-share-reader").analyze()).violations).toEqual([]);
  });
  test("share loading, empty scope and revoked-link states retain one main landmark", async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    let release: () => void = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    let revoked = false;
    await page.route("**/api/v1/**", async route => {
      await pending;
      await route.fulfill({ status: revoked ? 404 : 200, json: { code: revoked ? "SHARE_NOT_FOUND" : "OK", message: revoked ? "分享已撤销" : "", request_id: "sharing-state-ui", data: revoked ? null : { title: "空分享", root_document_id: null, directory_version: 1, ...dataPage([]) } } });
    });
    await page.goto(`/share/${token}`);
    await expect(page.getByRole("heading", { name: "正在打开分享…" })).toBeVisible();
    release();
    const empty = page.getByRole("heading", { name: "此范围还没有文档" });
    await expect(empty).toBeVisible();
    await expect(empty).toHaveCSS("font-size", "24px");
    await expect(empty.locator("..")).toHaveCSS("padding", "64px 32px");
    expect((await empty.locator("..").boundingBox())?.width).toBe(width === 390 ? 390 : 760);
    expect((await new AxeBuilder({ page }).include(".public-share-reader").analyze()).violations).toEqual([]);
    revoked = true;
    await page.getByRole("button", { name: "刷新目录与正文" }).click();
    await expect(page.getByRole("heading", { name: "分享已失效或文档不可访问" })).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
    expect((await new AxeBuilder({ page }).include('[data-ui="public-share"]').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

for (const width of [390, 640, 760]) test(`long share title keeps header actions reachable at ${width}px`, async ({ page }) => {
  const title = "公开分享的产品知识资料操作说明".repeat(3).slice(0, 40);
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => localStorage.setItem("orbis.appearance", "light"));
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const document = { id: rootId, title: root.title, content_version: 2, updated_at_ms: now };
    const data = path.endsWith("/directory")
      ? { title, root_document_id: rootId, directory_version: 1, ...dataPage([root]) }
      : path.endsWith("/children")
        ? { document, items: [], pagination: { next_cursor: null, has_more: false } }
        : document;
    await route.fulfill({ json: { code: "OK", message: "", request_id: "sharing-long-title", data } });
  });
  await page.goto(`/share/${token}`);
  const header = page.locator(".public-share-reader > header");
  const brand = header.getByRole("link", { name: title, exact: true });
  const license = header.getByRole("link", { name: "源码与许可", exact: true });
  const refresh = header.getByRole("button", { name: "刷新目录与正文" });
  await expect(brand).toHaveText(title);
  await expect(brand).toHaveAttribute("href", `/share/${token}`);
  await expect(license).toHaveAttribute("href", "/licenses/");
  const bounds = (await header.boundingBox())!;
  expect(bounds.height).toBe(66);
  for (const control of [brand, license, refresh]) {
    await expect(control).toBeInViewport();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.y).toBeGreaterThanOrEqual(bounds.y);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  }
  await license.focus();
  await expect(license).toBeFocused();
  expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
