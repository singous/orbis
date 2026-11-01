import { expect, test, type Page } from "@playwright/test";
import { installSession } from "../ui-browser/fixtures/session";
import { installHomeFixture } from "../ui-browser/fixtures/home";
import { documentEditorHTTP, documentId } from "../ui-browser/fixtures/document-editor";
import { boardHTTP, mountBoard } from "../ui-browser/fixtures/board";
import { sheetHTTP, mountWorkspace } from "../ui-browser/fixtures/sheet-workspace";
import { readerHTTP } from "../ui-browser/fixtures/site-reader";

async function settleSurface(page: Page) {
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).filter(image => image.getClientRects().length).map(image => image.decode()));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

for (const theme of ["light", "dark"] as const) for (const width of [1280, 390]) {
  test.describe(`${theme} ${width}px business surfaces`, () => {
    test.use({ hasTouch: width === 390 });
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(theme => {
        Date.now = () => Date.parse("2026-11-01T00:00:00Z");
        localStorage.setItem("orbis.appearance", theme);
      }, theme);
    });

    test("home", async ({ page }) => {
      await installHomeFixture(page);
      await page.goto("/home");
      await expect(page.locator(".home-document-row")).toHaveCount(3);
      await expect(page.getByRole("region", { name: "快速记录" }).getByRole("textbox", { name: "随手记正文" })).toBeVisible();
      await expect(page.getByRole("img", { name: /^近期内容足迹，本月有/ })).toBeVisible();
      await settleSurface(page);
      await expect(page).toHaveScreenshot(`home-${theme}-${width}.png`);
    });

    test("document editor", async ({ page }) => {
      await installSession(page);
      const mutations = await documentEditorHTTP(page);
      await page.goto(`/documents/${documentId}`);
      await expect(page.getByRole("textbox", { name: "文档标题", exact: true })).toHaveValue("界面平台化设计");
      await expect(page.locator(".ProseMirror")).toContainText("这是一份固定的文档内容");
      await expect(page.getByRole("toolbar", { name: "文档格式", exact: true })).toBeVisible();
      await expect(page.locator(".document-save-state")).toHaveText("已保存");
      await settleSurface(page);
      expect(mutations).toEqual([]);
      await expect(page).toHaveScreenshot(`document-editor-${theme}-${width}.png`);
    });

    test("board editor", async ({ page }) => {
      await installSession(page);
      const mutations = await boardHTTP(page);
      await mountBoard(page, "editor");
      await expect(page.getByRole("application", { name: "画板编辑区域", exact: true })).toBeVisible();
      await expect(page.getByRole("tab", { name: "主画布", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("heading", { name: "体验设计画板", exact: true })).toBeVisible();
      if (width === 1280) await expect(page.getByRole("link", { name: "设计手册", exact: true })).toBeVisible();
      const canvas = page.locator(".board-render-surface canvas").first();
      await expect(canvas).toBeVisible();
      await expect.poll(() => canvas.evaluate(element => {
        const canvas = element as HTMLCanvasElement;
        return canvas.width > 200 && canvas.height > 200 ? Array.from(canvas.getContext("2d")!.getImageData(200, 200, 1, 1).data) : [];
      })).toEqual([255, 255, 255, 255]);
      await settleSurface(page);
      expect(mutations).toEqual([]);
      await expect(page).toHaveScreenshot(`board-editor-${theme}-${width}.png`);
    });

    test("sheet workspace and filter", async ({ page }) => {
      await installSession(page);
      const mutations = await sheetHTTP(page);
      await mountWorkspace(page);
      const workspace = page.getByRole("region", { name: "产品计划", exact: true });
      await expect(workspace.getByRole("textbox", { name: "搜索记录", exact: true })).toBeVisible();
      await expect(workspace.getByRole("columnheader")).toHaveText(["名称", "状态", "数量"]);
      await expect(workspace.getByRole("gridcell").filter({ hasText: "示例记录" })).toHaveCount(2);
      await settleSurface(page);
      await expect(page).toHaveScreenshot(`sheet-workspace-${theme}-${width}.png`);
      await workspace.getByRole("button", { name: "筛选", exact: true }).click();
      const filter = page.getByRole("dialog", { name: "筛选", exact: true });
      await expect(filter.getByRole("combobox", { name: "筛选字段 1", exact: true })).toBeVisible();
      await expect(filter.getByRole("textbox", { name: "名称", exact: true })).toHaveValue("示例");
      await settleSurface(page);
      expect(mutations).toEqual([]);
      await expect(page).toHaveScreenshot(`sheet-filter-${theme}-${width}.png`);
    });

    test("public site reader", async ({ page, baseURL }) => {
      await page.addInitScript(theme => localStorage.setItem("orbis-reader-theme", theme), theme);
      await readerHTTP(page, baseURL);
      await page.goto("/s/guide");
      await expect(page.getByText("当前页面正文", { exact: true })).toBeVisible();
      await expect(page.locator(".site-reader")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(width === 1280 ? ".site-reader-outline" : ".site-reader-mobile-outline")).toBeVisible();
      await expect(page.locator(".site-reader-page-footer")).toHaveText("最后更新于 1970年1月1日");
      await settleSurface(page);
      await expect(page).toHaveScreenshot(`public-site-reader-${theme}-${width}.png`);
    });
  });
}
