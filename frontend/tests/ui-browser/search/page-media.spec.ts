import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { z } from "zod";
import type { searchResultSchema } from "../../../src/features/search/api";
import { SEARCH_DEBOUNCE_MS } from "../../../src/features/search/search-state";
import { documentEditorHTTP, documentId } from "../fixtures/document-editor";
import { expectNoContinuingMotion, expectVisibleKeyboardFocus } from "../fixtures/media";
import { installSession, workspace } from "../fixtures/session";

type WireResult = z.input<typeof searchResultSchema>;
const commonResult: Omit<WireResult, "id" | "type" | "title"> = {
  workspace_id: workspace.id, location: "产品知识库 / 检索资料", snippet: "服务端返回的检索摘要，保留原有结果顺序与资源位置。",
  match: "body", matched_comment_id: null, status: "active", updated_at_ms: 1, collection_id: null, group_id: null,
};
const documents: WireResult[] = [
  { ...commonResult, id: documentId, type: "document", title: "服务端第二名：界面设计规范与使用说明" },
  { ...commonResult, id: "00000000-0000-4000-8000-000000000090", type: "document", title: "服务端第一名：后更新的文档", updated_at_ms: 100 },
];
const notebooks: WireResult[] = [
  { ...commonResult, id: "00000000-0000-4000-8000-000000000021", collection_id: "00000000-0000-4000-8000-000000000021", type: "collection", title: "笔记本服务端第二名" },
  { ...commonResult, id: "00000000-0000-4000-8000-000000000091", collection_id: "00000000-0000-4000-8000-000000000091", type: "collection", title: "笔记本服务端第一名", updated_at_ms: 100 },
];
const secondNotebookPage: WireResult = { ...notebooks[0], id: "00000000-0000-4000-8000-000000000092", title: "第二页的笔记本结果" };
const archivedNotebooks: WireResult[] = notebooks.map(item => ({ ...item, status: "archived", title: `已归档：${item.title}` }));

function searchPage(items: WireResult[], page: number) {
  return { items, pagination: { page, page_size: 20, total: 21 } };
}

async function installSearchPageFixture(page: Page) {
  await installSession(page);
  const mutations = await documentEditorHTTP(page);
  const requests: URL[] = [];
  const responses: Record<string, ReturnType<typeof searchPage>> = {
    "all:all:1": searchPage([documents[0], notebooks[0]], 1),
    "document:all:1": searchPage(documents, 1),
    "document:all:2": searchPage([{ ...documents[0], title: "第二页的文档结果" }], 2),
    "collection:all:1": searchPage(notebooks, 1),
    "collection:all:2": searchPage([secondNotebookPage], 2),
    "collection:archived:1": searchPage(archivedNotebooks, 1),
    "document:archived:1": searchPage([{ ...documents[0], status: "archived" }], 1),
    "document:active:1": searchPage(documents, 1),
  };
  await page.route(url => url.pathname === `/api/v1/workspaces/${workspace.id}/search`, async route => {
    expect(route.request().method()).toBe("GET");
    const url = new URL(route.request().url());
    requests.push(url);
    expect(url.searchParams.get("q")).toBeTruthy();
    expect(url.searchParams.get("page_size")).toBe("20");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.has("workspace_id")).toBe(false);
    const key = `${url.searchParams.get("type")}:${url.searchParams.get("status")}:${url.searchParams.get("page")}`;
    const data = responses[key];
    if (!data) throw new Error(`Unexpected search page fixture request: ${url.pathname}${url.search}`);
    await route.fulfill({ json: { code: "OK", message: "", request_id: "search-page-media", data } });
  });
  return { requests, mutations };
}

async function expectSearchLocation(page: Page, parameters: Record<string, string>) {
  await expect(page).toHaveURL(url => url.pathname === "/search");
  await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toEqual(parameters);
}

for (const theme of ["light", "dark"] as const) for (const width of [1280, 390]) test.describe(`${theme} ${width}px full search page`, () => {
  test.use({ hasTouch: width === 390 });
  test("renders server order, readable filters and pagination without horizontal overflow", async ({ page }, info) => {
    const { requests, mutations } = await installSearchPageFixture(page);
    const evidence: Record<string, unknown> = { theme, width, mutations };
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    try {
      await page.goto("/search?q=设计&status=all");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("heading", { name: "全局搜索", exact: true })).toBeVisible();
      const content = page.locator(".page-container");
      const form = page.getByRole("search", { name: "内容搜索", exact: true });
      await expect(content.getByRole("heading", { level: 2 })).toHaveText([documents[0].title, notebooks[0].title]);
      await expect(content.getByRole("status")).toHaveText("找到 21 条结果");
      const links = content.getByRole("list").getByRole("link");
      await expect(links.first()).toHaveAttribute("href", `/documents/${documentId}`);
      await expect(links.last()).toHaveAttribute("href", `/collections/${notebooks[0].id}`);
      await expect(links.last()).toContainText("笔记本");
      await expect(form.getByRole("searchbox", { name: "搜索内容", exact: true })).toHaveValue("设计");
      const type = form.getByRole("combobox", { name: "内容类型", exact: true });
      const status = form.getByRole("combobox", { name: "内容状态", exact: true });
      await expect(type).toContainText("全部内容");
      await expect(status).toContainText("包含归档");
      const typeBox = (await type.boundingBox())!, statusBox = (await status.boundingBox())!;
      if (width === 1280) {
        expect(typeBox.y).toBeCloseTo(statusBox.y, 1);
        expect(typeBox.x + typeBox.width).toBeLessThanOrEqual(statusBox.x);
      } else expect(typeBox.y + typeBox.height).toBeLessThanOrEqual(statusBox.y);
      const geometry = await content.evaluate(element => ({ box: element.getBoundingClientRect().toJSON(), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
      for (const link of await links.all()) {
        const box = (await link.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(geometry.box.x);
        expect(box.x + box.width).toBeLessThanOrEqual(geometry.box.x + geometry.box.width);
      }
      evidence.geometry = { ...geometry, type: typeBox, status: statusBox };
      const routeContent = page.locator("#workspace-main-content");
      await routeContent.evaluate(async element => {
        await document.fonts.ready;
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await Promise.all(element.getAnimations().filter(animation => animation.pending || animation.playState === "running").map(animation => animation.finished));
      });
      await expect(routeContent).toHaveCSS("opacity", "1");
      const resultAxe = await new AxeBuilder({ page }).analyze();
      expect(resultAxe.violations).toEqual([]);
      await form.getByRole("button", { name: "清空搜索", exact: true }).click();
      await expectSearchLocation(page, { status: "all" });
      await expect(content.getByText("输入关键词，查找文档、评论或文件。", { exact: true })).toBeVisible();
      await expect(type).toContainText("全部内容");
      await expect(status).toContainText("包含归档");
      const emptyAxe = await new AxeBuilder({ page }).analyze();
      evidence.axe = { results: resultAxe.violations, empty: emptyAxe.violations };
      expect(emptyAxe.violations).toEqual([]);
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every(url => Boolean(url.searchParams.get("q")))).toBe(true);
      expect(mutations).toEqual([]);
    } finally {
      evidence.requests = requests.map(url => ({ path: url.pathname, parameters: Object.fromEntries(url.searchParams) }));
      await info.attach("search-page-default", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
    }
  });
});

for (const { theme, width } of [{ theme: "light", width: 1280 }, { theme: "dark", width: 390 }] as const) test.describe(`media acceptance: full search ${theme} ${width}`, () => {
  test.use({ hasTouch: width === 390 });
  test("keeps IME, server filters, pages and keyboard navigation", async ({ page }, info) => {
  const { requests, mutations } = await installSearchPageFixture(page);
  const evidence: Record<string, unknown> = { theme, width, forcedColors: "active", reducedMotion: "reduce", mutations };
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  try {
    await page.goto("/search?q=设计&type=document&status=all&page=2");
    const content = page.locator(".page-container");
    const input = page.getByRole("searchbox", { name: "搜索内容", exact: true });
    const type = page.getByRole("combobox", { name: "内容类型", exact: true });
    const status = page.getByRole("combobox", { name: "内容状态", exact: true });
    await expect(content.getByRole("heading", { level: 2 })).toHaveText(["第二页的文档结果"]);
    evidence.inputFocus = await expectVisibleKeyboardFocus(input);
    await input.dispatchEvent("compositionstart", { data: "未完成" });
    await input.fill("未完成拼音");
    const compositionStart = await page.evaluate(() => performance.now());
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(start => performance.now() - start, compositionStart)).toBeGreaterThan(SEARCH_DEBOUNCE_MS);
    await expectSearchLocation(page, { q: "设计", type: "document", status: "all", page: "2" });
    expect(requests.some(url => url.searchParams.get("q") === "未完成拼音")).toBe(false);
    await input.fill("设计检索");
    await input.dispatchEvent("compositionend", { data: "设计检索" });
    await expectSearchLocation(page, { q: "设计检索", type: "document", status: "all" });
    await expect(content.getByRole("heading", { level: 2 })).toHaveText(documents.map(item => item.title));

    await type.focus();
    evidence.typeFocus = await expectVisibleKeyboardFocus(type);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option", { name: "文档与评论", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByRole("option", { name: "全部内容", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option", { name: "文档与评论", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    const notebookOption = page.getByRole("option", { name: "笔记本", exact: true });
    await expect(notebookOption).toBeFocused();
    await expect(notebookOption).toHaveAttribute("data-highlighted", "");
    evidence.optionFocus = await notebookOption.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
    evidence.selectMotion = await expectNoContinuingMotion(page.locator('[data-slot="select-content"]'));
    const optionAxe = await new AxeBuilder({ page }).analyze();
    expect(optionAxe.violations).toEqual([]);
    await page.keyboard.press("Enter");
    await expectSearchLocation(page, { q: "设计检索", type: "notebook", status: "all" });
    await expect(content.getByRole("heading", { level: 2 })).toHaveText(notebooks.map(item => item.title));
    await expect.poll(() => requests.at(-1)?.searchParams.get("type")).toBe("collection");
    expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
    const next = page.getByRole("navigation", { name: "搜索结果分页", exact: true }).getByRole("button", { name: "下一页", exact: true });
    await next.focus();
    evidence.pageFocus = await expectVisibleKeyboardFocus(next);
    await page.keyboard.press("Enter");
    await expectSearchLocation(page, { q: "设计检索", type: "notebook", status: "all", page: "2" });
    await expect(content.getByRole("heading", { level: 2 })).toHaveText([secondNotebookPage.title]);
    await expect(page.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
    expect(requests.at(-1)?.searchParams.get("type")).toBe("collection");
    expect(requests.at(-1)?.searchParams.get("page")).toBe("2");
    await status.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option", { name: "包含归档", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByRole("option", { name: "当前内容", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    const archived = page.getByRole("option", { name: "已归档", exact: true });
    await expect(archived).toBeFocused();
    await expect(archived).toHaveAttribute("data-highlighted", "");
    evidence.statusOptionFocus = await archived.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
    await page.keyboard.press("Enter");
    await expectSearchLocation(page, { q: "设计检索", type: "notebook", status: "archived" });
    await expect(content.getByRole("heading", { level: 2 })).toHaveText(archivedNotebooks.map(item => item.title));
    expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
    expect(requests.at(-1)?.searchParams.get("status")).toBe("archived");
    await expect(content.getByRole("list").getByRole("link").first()).toHaveAttribute("href", `/documents/archive?resource=${notebooks[0].id}&type=notebook`);

    await type.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option", { name: "笔记本", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByRole("option", { name: "全部内容", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option", { name: "文档与评论", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expectSearchLocation(page, { q: "设计检索", type: "document", status: "archived" });
    await expect(type).toContainText("文档与评论");
    await expect(content.getByRole("heading", { level: 2 })).toHaveText([documents[0].title]);
    await status.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option", { name: "已归档", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByRole("option", { name: "当前内容", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expectSearchLocation(page, { q: "设计检索", type: "document" });
    await expect(content.getByRole("heading", { level: 2 })).toHaveText(documents.map(item => item.title));
    const result = content.getByRole("list").getByRole("link").first();
    await result.focus();
    evidence.resultFocus = await expectVisibleKeyboardFocus(result);
    const pageAxe = await new AxeBuilder({ page }).analyze();
    expect(pageAxe.violations).toEqual([]);

    const drawer = page.getByRole("button", { name: "打开主导航", exact: true });
    if (width === 390) { await drawer.focus(); await page.keyboard.press("Enter"); }
    const userMenu = page.getByRole("button", { name: "打开用户菜单", exact: true });
    await userMenu.focus();
    await page.keyboard.press("Enter");
    const appearance = page.getByRole("menuitem", { name: "外观", exact: true });
    await appearance.focus();
    await page.keyboard.press("Enter");
    const appearanceDialog = page.getByRole("dialog", { name: "外观", exact: true });
    await expect(appearanceDialog.getByRole("radio", { name: theme === "light" ? "白天" : "夜间", exact: true })).toBeChecked();
    evidence.dialogMotion = await expectNoContinuingMotion(appearanceDialog);
    evidence.backdropMotion = await expectNoContinuingMotion(page.locator('[data-slot="dialog-overlay"]'));
    const dialogAxe = await new AxeBuilder({ page }).analyze();
    expect(dialogAxe.violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(appearanceDialog).toBeHidden();
    evidence.menuRestoredFocus = await expectVisibleKeyboardFocus(userMenu);
    if (width === 390) { await page.keyboard.press("Escape"); evidence.drawerRestoredFocus = await expectVisibleKeyboardFocus(drawer); }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectSearchLocation(page, { q: "设计检索", type: "document" });

    await result.focus();
    evidence.openResultFocus = await expectVisibleKeyboardFocus(result);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/documents/${documentId}`);
    await expect(page.getByRole("textbox", { name: "文档标题", exact: true })).toHaveValue("界面平台化设计");
    await page.goBack();
    await expectSearchLocation(page, { q: "设计检索", type: "document" });
    evidence.returnedInputFocus = await expectVisibleKeyboardFocus(page.getByRole("searchbox", { name: "搜索内容", exact: true }));
    evidence.axe = { option: optionAxe.violations, page: pageAxe.violations, appearance: dialogAxe.violations };
    expect(requests.some(url => url.searchParams.get("q") === "未完成拼音")).toBe(false);
    expect(mutations).toEqual([]);
  } finally {
    evidence.requests = requests.map(url => ({ path: url.pathname, parameters: Object.fromEntries(url.searchParams) }));
    await info.attach("search-page-media", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  }
  });
});
