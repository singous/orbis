import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { boardHTTP, documentId as boardDocumentId } from "../fixtures/board";
import { documentEditorHTTP, documentId } from "../fixtures/document-editor";
import { expectNoContinuingMotion, expectVisibleKeyboardFocus } from "../fixtures/media";
import { installSession } from "../fixtures/session";
import { installSheetRouteFixture, sheetRoutePath } from "../fixtures/sheet-route";
import { readerHTTP, siteId } from "../fixtures/site-reader";

async function expectAccessibleRoute(page: Page, info: TestInfo) {
  const result = await new AxeBuilder({ page }).analyze();
  await info.attach("route-accessibility", { body: JSON.stringify(result.violations), contentType: "application/json" });
  expect(result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, html, failureSummary }) => ({ target, html, failureSummary })) }))).toEqual([]);
}

for (const profile of [{ theme: "light", width: 1280 }, { theme: "dark", width: 390 }] as const) test.describe(`route media ${profile.theme} ${profile.width}px`, () => {
  test.use({ viewport: { width: profile.width, height: 900 }, hasTouch: profile.width === 390 });
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), profile.theme);
  });

  test("formal document keeps readable keyboard menus and the editor instance", async ({ page }, info) => {
    await installSession(page);
    const mutations = await documentEditorHTTP(page);
    await page.goto(`/documents/${documentId}`);
    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("这是一份固定的文档内容");
    const original = await editor.elementHandle();
    const trigger = page.getByRole("button", { name: "更多文档操作", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "文档操作", exact: true });
    await expect(menu.getByRole("menuitem", { name: "归档文档", exact: true })).toBeFocused();
    const menuMotion = await expectNoContinuingMotion(menu);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    const focus = await expectVisibleKeyboardFocus(trigger);
    expect(await editor.evaluate((element, original) => element === original, original)).toBe(true);
    await expect(editor).toContainText("这是一份固定的文档内容");
    expect(mutations).toEqual([]);
    const mainMotion = await expectNoContinuingMotion(page.getByRole("main"));
    await expectAccessibleRoute(page, info);
    await info.attach("formal-document-media", { body: JSON.stringify({ profile, focus, menuMotion, mainMotion, mutations }), contentType: "application/json" });
  });

  test("formal board keeps zoom keyboard focus, page selection and motion limits", async ({ page }, info) => {
    await installSession(page);
    const mutations = await boardHTTP(page);
    await page.goto(`/documents/${boardDocumentId}`);
    await expect(page.getByRole("application", { name: "画板编辑区域", exact: true })).toBeVisible();
    const zoom = page.getByRole("button", { name: /缩放比例/ });
    await zoom.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "画板缩放比例", exact: true });
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    const itemFocus = await expectVisibleKeyboardFocus(menu.getByRole("menuitem").first());
    const menuMotion = await expectNoContinuingMotion(menu);
    await page.keyboard.press("Escape");
    const focus = await expectVisibleKeyboardFocus(zoom);
    const pageTab = page.getByRole("tab", { name: "主画布", exact: true });
    await pageTab.focus();
    await page.keyboard.press("ArrowRight");
    const review = page.getByRole("tab", { name: "评审画布", exact: true });
    await expect(review).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(review).toHaveAttribute("aria-selected", "true");
    const toolbarMotion = await expectNoContinuingMotion(page.getByRole("toolbar", { name: "画板工具", exact: true }));
    expect(mutations).toEqual([]);
    await expectAccessibleRoute(page, info);
    await info.attach("formal-board-media", { body: JSON.stringify({ profile, itemFocus, focus, menuMotion, toolbarMotion, mutations }), contentType: "application/json" });
  });

  test("formal sheet keeps nested select focus and cancels its draft filter", async ({ page }, info) => {
    await installSheetRouteFixture(page);
    await page.goto(sheetRoutePath);
    await expect(page.getByText("示例记录 1", { exact: true })).toBeVisible();
    const trigger = page.getByRole("button", { name: "筛选", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "筛选", exact: true });
    const field = dialog.getByRole("combobox", { name: "筛选字段 1", exact: true });
    await field.focus();
    await page.keyboard.press("Enter");
    const active = page.getByRole("option", { name: "名称", exact: true });
    await expect(active).toBeFocused();
    const optionFocus = await expectVisibleKeyboardFocus(active);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    const nestedFocus = await expectVisibleKeyboardFocus(field);
    const dialogMotion = await expectNoContinuingMotion(dialog);
    const value = dialog.getByRole("textbox", { name: "名称", exact: true });
    await value.focus();
    await page.keyboard.type("尚未应用");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    const focus = await expectVisibleKeyboardFocus(trigger);
    await expect(page.getByText("示例记录 1", { exact: true })).toBeVisible();
    await expect(page.getByText("示例记录 2", { exact: true })).toBeVisible();
    await expectAccessibleRoute(page, info);
    await info.attach("formal-sheet-media", { body: JSON.stringify({ profile, optionFocus, nestedFocus, focus, dialogMotion }), contentType: "application/json" });
  });

  test("successful preview keeps keyboard search, navigation and its private scope", async ({ page, baseURL }, info) => {
    await installSession(page);
    const requests = await readerHTTP(page, baseURL);
    await page.goto(`/sites/${siteId}/preview`);
    await expect(page.getByText("当前页面正文", { exact: true })).toBeVisible();
    await expect(page.locator(".site-reader-preview-banner")).toContainText("只有工作空间成员可见");
    const trigger = page.getByRole("button", { name: "搜索文档 ⌘ K", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "搜索文档", exact: true });
    const input = dialog.getByRole("combobox", { name: "搜索文档", exact: true });
    const focus = await expectVisibleKeyboardFocus(input);
    const motion = await expectNoContinuingMotion(dialog);
    await page.keyboard.type("安装");
    await expect(dialog.getByRole("option", { name: /安装指南/ })).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/sites/${siteId}/preview/guides/install$`));
    await expect(page.getByText("安装专用正文", { exact: true })).toBeVisible();
    const returnedFocus = await expectVisibleKeyboardFocus(trigger);
    expect(requests.some(path => path.startsWith("/api/v1/public/"))).toBe(false);
    await expectAccessibleRoute(page, info);
    await info.attach("preview-media", { body: JSON.stringify({ profile, focus, returnedFocus, motion, requests }), contentType: "application/json" });
  });
});
