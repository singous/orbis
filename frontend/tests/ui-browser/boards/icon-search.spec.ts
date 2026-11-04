import { expect, test } from "@playwright/test";
import { boardHTTP, boardId, mountBoard } from "../fixtures/board";
import { installSession } from "../fixtures/session";
import type { Mutation } from "../../../src/features/boards/model";

const OVERSCAN_ROW_ALLOWANCE = 8;

for (const width of [2048, 390]) test.describe(`complete board library at ${width}px`, () => {
  test.use({ actionTimeout: 12_000, hasTouch: width === 390, viewport: { width, height: 1157 } });

  test("virtual icons stay bounded and searchable with the complete index", async ({ page }) => {
    await installSession(page);
    await boardHTTP(page);
    const writes: Mutation[] = [];
    await page.route(`**/boards/${boardId}/commands`, async route => {
      const input = route.request().postDataJSON() as Mutation;
      writes.push(input);
      const command = input.commands[0];
      expect(command.type).toBe("elements.create");
      await route.fulfill({ json: { code: "OK", message: "", request_id: "icon-search", data: {
        operation_id: input.operation_id, revision: writes.length + 1,
        elements: command.type === "elements.create" ? command.elements : [],
        deleted: [], pages: [], deleted_pages: [], updated_at_ms: 1,
      } } });
    });
    await mountBoard(page, "editor");
    await page.getByRole("button", { name: "切换素材面板", exact: true }).click();
    const indexResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/board-icons/tabler-1.2.42/index.json"));
    await page.getByRole("tab", { name: "图标", exact: true }).click();
    const index = await (await indexResponse).json() as { count: number; items: unknown[] };
    expect(index.count).toBeGreaterThan(1_000);
    expect(index.items).toHaveLength(index.count);
    const totalLabel = await page.evaluate(count => `${count.toLocaleString()} 个图标`, index.count);
    await expect(page.locator(".board-result-count")).toHaveText(totalLabel);
    await expect(page.locator(".board-icon-row button").first()).toBeVisible();
    const geometry = await page.locator(".board-icon-browser").evaluate(element => ({
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
      bottom: element.getBoundingClientRect().bottom,
      panelBottom: element.parentElement!.getBoundingClientRect().bottom,
      libraryBottom: element.closest(".board-library")!.getBoundingClientRect().bottom,
      rows: element.querySelectorAll(".board-icon-row").length,
      rowHeight: element.querySelector(".board-icon-row")!.getBoundingClientRect().height,
    }));
    expect(geometry.height).toBeGreaterThan(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.libraryBottom);
    expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.libraryBottom);
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.height);
    // 额外容纳首尾各四行缓冲；上限由真实视窗与行高决定，不随图标总量增长。
    expect(geometry.rows).toBeLessThanOrEqual(Math.ceil(geometry.height / geometry.rowHeight) + OVERSCAN_ROW_ALLOWANCE);
    const search = page.getByRole("textbox", { name: "搜索画板素材", exact: true });
    await search.fill("server");
    const icon = page.getByRole("button", { name: "插入图标 server", exact: true });
    await icon.click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].commands[0]).toMatchObject({ type: "elements.create", elements: [expect.objectContaining({ structure: expect.objectContaining({ icon_id: "server" }) })] });
    await expect(page.locator(".board-save-state")).toHaveText("已保存");
    await search.fill("");
    await expect(page.locator(".board-result-count")).toHaveText(totalLabel);
    const browser = page.locator(".board-icon-browser");
    await browser.evaluate(element => element.scrollTo(0, element.scrollHeight));
    await expect.poll(() => browser.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await search.fill("server");
    await expect.poll(() => browser.evaluate(element => element.scrollTop)).toBe(0);
    await icon.click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1].commands[0]).toMatchObject({ type: "elements.create", elements: [expect.objectContaining({ structure: expect.objectContaining({ icon_id: "server" }) })] });
    await expect(page.locator(".board-save-state")).toHaveText("已保存");
    await page.getByRole("tab", { name: "模板", exact: true }).click();
    const templateBounds = await page.locator(".board-template-list button").evaluateAll(elements => elements.map(element => ({
      top: element.getBoundingClientRect().top,
      previewBottom: element.querySelector(".board-template-art")!.getBoundingClientRect().bottom,
    })));
    expect(templateBounds.length).toBeGreaterThan(1);
    for (let index = 1; index < templateBounds.length; index++) {
      expect(templateBounds[index - 1].previewBottom).toBeLessThanOrEqual(templateBounds[index].top);
    }
    const category = page.getByRole("combobox", { name: "图类型", exact: true });
    await category.click();
    await page.getByRole("option", { name: "ER 图", exact: true }).click();
    await expect(page.getByRole("button", { name: /用户权限/ })).toBeVisible();
    await category.click();
    await page.getByRole("option", { name: "思维导图", exact: true }).click();
    await expect(page.getByRole("button", { name: /项目规划/ })).toBeVisible();
  });
});
