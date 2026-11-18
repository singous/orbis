import { expect, test } from "@playwright/test";
import { installSession } from "../fixtures/session";
import { controlId as id, mountTableControl, tableControlDefinition, tableControlView } from "../fixtures/table-controls";

for (const theme of ["light", "dark"] as const) for (const width of [1280, 390]) test.describe(`${theme} table controls ${width}`, () => {
  test.use({ hasTouch: width === 390 });
  test("native multi-select keeps keyboard values and board cards keep paging and drag data", async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installSession(page);
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    for (const kind of ["dt-multi", "dt-form-multi"] as const) {
      await mountTableControl(page, kind);
      const summary = page.getByLabel("标签", { exact: true });
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("checkbox").first()).toBeChecked();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("checkbox").first()).toBeFocused();
      await page.keyboard.press("Space");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Space");
      await expect(page.locator('output[aria-label="当前值"]')).toHaveText(JSON.stringify([id(10)]));
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await expect(summary.locator("..")).not.toHaveAttribute("open");
      await expect(page.locator('output[aria-label="提交记录"]')).toHaveText("[{}]");
    }
    const requests: URL[] = [];
    await page.route("**/api/v1/**", async route => {
      const url = new URL(route.request().url());
      requests.push(url);
      const pageNumber = Number(url.searchParams.get("page")), empty = url.searchParams.get("group_id") === id(7);
      const data = { table: { table_id: id(12), block_id: id(13), table_version: 1, content_version: 1, definition: tableControlDefinition }, view_id: tableControlView.id, items: empty ? [] : [{ id: id(14), values: { [id(4)]: pageNumber === 1 ? "卡片记录" : "第二页记录", [id(5)]: id(6), [id(8)]: [id(9)] } }], groups: [], pagination: { page: pageNumber, page_size: 100, total: empty ? 0 : 101 } };
      await route.fulfill({ json: { code: "OK", message: "", request_id: "table-picker", data } });
    });
    await mountTableControl(page, "dt-board");
    const card = page.getByRole("button", { name: /卡片记录/ });
    await expect(card).toBeVisible();
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status", { name: "打开记录" })).toHaveText(id(14));
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent("dragstart", { dataTransfer: transfer });
    expect(await transfer.evaluate(value => value.getData("application/orbis-table-record"))).toBe(id(14));
    await page.getByRole("region", { name: "已完成", exact: true }).dispatchEvent("drop", { dataTransfer: transfer });
    await expect(page.getByRole("status", { name: "分组变更" })).toHaveText(JSON.stringify([id(14), id(7)]));
    await page.getByRole("region", { name: "待处理", exact: true }).getByRole("button", { name: "下一页", exact: true }).click();
    await expect(page.getByRole("button", { name: /第二页记录/ })).toBeVisible();
    expect(requests.some(url => url.searchParams.get("page") === "2" && url.searchParams.get("group_id") === id(6) && url.searchParams.get("document_version") === "1")).toBe(true);
    expect(requests.every(url => url.searchParams.get("view_id") === tableControlView.id)).toBe(true);
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    const nextCard = page.getByRole("button", { name: /第二页记录/ });
    await nextCard.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(nextCard).toBeFocused();
    await expect(nextCard).toHaveCSS("outline-width", "2px");
    await expect(nextCard).toHaveCSS("outline-style", "solid");
  });
});
