import { expect, test, type Page } from "@playwright/test";
import { installSession } from "../fixtures/session";
import { initialSheet, mountWorkspace, records, sheetReadData } from "../fixtures/sheet-workspace";

async function openSheet(page: Page, failSave = false) {
  await installSession(page);
  let sheet = structuredClone(initialSheet);
  sheet.definition.fields[2] = { ...sheet.definition.fields[2], name: "日期", kind: "datetime" };
  const writes: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === "PUT") {
      const body = request.postDataJSON();
      writes.push(body);
      if (failSave) return route.fulfill({ status: 422, json: { code: "VALIDATION_ERROR", message: "保存设置失败，请重试", request_id: "e2e-settings-failure", data: null } });
      sheet = { ...sheet, ...body, version: sheet.version + 1 };
    }
    const data = path.endsWith("/records") ? { items: records.map(record => ({ ...record, values: { ...record.values, number: null } })), next_cursor: "", schema_version: sheet.schema_version, duplicate_ids: {} } : sheetReadData(path, sheet);
    await route.fulfill({ json: { code: "OK", message: "", request_id: "e2e-sheet-consumers", data } });
  });
  await mountWorkspace(page);
  await expect(page.getByRole("gridcell").first()).toHaveText("示例记录 1");
  return writes;
}

test("field drag handles and filter comboboxes retain the original view intent", async ({ page }) => {
  const writes = await openSheet(page);
  await page.getByRole("button", { name: "字段管理", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "字段管理", exact: true });
  const from = (await manager.getByRole("button", { name: "拖拽排序日期", exact: true }).boundingBox())!;
  const to = (await manager.getByRole("button", { name: "拖拽排序名称", exact: true }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * .2, { steps: 10 });
  await page.mouse.up();
  await manager.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByRole("columnheader")).toHaveText(["日期", "名称", "状态"]);
  expect(writes[0]).toMatchObject({ version: 4, definition: { views: [{ field_ids: ["number", "name", "status"] }] } });
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  const filter = page.getByRole("dialog", { name: "筛选", exact: true });
  await expect(filter.getByRole("combobox", { name: "筛选字段 1", exact: true })).toContainText("名称");
  await filter.getByRole("combobox", { name: "筛选条件 1", exact: true }).click();
  await page.getByRole("option", { name: "包含", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(filter.getByRole("textbox", { name: "名称", exact: true })).toHaveValue("示例");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "筛选", exact: true })).toBeFocused();
});

for (const kind of ["field", "view"] as const) test(`${kind} draft survives named toast dismissal and repeated failures`, async ({ page }) => {
  const writes = await openSheet(page, true);
  if (kind === "field") {
    await page.getByRole("button", { name: "状态列菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "编辑列", exact: true }).click();
  } else await page.getByRole("button", { name: "字段管理", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: kind === "field" ? "字段设置" : "字段管理", exact: true });
  if (kind === "field") await dialog.getByRole("textbox", { name: "字段名称", exact: true }).fill("未保存的状态列");
  else await dialog.getByRole("checkbox", { name: "日期", exact: true }).uncheck();
  const save = dialog.getByRole("button", { name: kind === "field" ? "保存字段" : "应用", exact: true });
  const notification = page.getByRole("alertdialog", { name: "保存设置失败，请重试", exact: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    await save.click();
    await expect(notification).toBeVisible();
    if (attempt === 1) await page.mouse.move(0, 0);
    else await notification.getByRole("button", { name: "关闭通知", exact: true }).click();
    await expect(notification).toHaveCount(0);
    if (kind === "field") await expect(dialog.getByRole("textbox", { name: "字段名称", exact: true })).toHaveValue("未保存的状态列");
    else await expect(dialog.getByRole("checkbox", { name: "日期", exact: true })).not.toBeChecked();
  }
  expect(writes).toHaveLength(3);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[2]).toEqual(writes[0]);
});

test.describe("touch", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test("search and ISO-named calendar days retain their touch geometry", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openSheet(page);
    await expect(page.getByRole("textbox", { name: "搜索记录", exact: true })).toHaveCSS("font-size", "16px");
    const controls = await page.locator(".sheet-toolbar > .orbis-action-button").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
    expect(controls).toHaveLength(6);
    for (const height of controls) expect(height).toBeGreaterThanOrEqual(44);
    const cell = page.getByRole("gridcell").nth(2);
    await cell.tap();
    await cell.tap();
    await cell.tap();
    const picker = page.getByRole("dialog", { name: "日期选择", exact: true });
    const days = picker.getByRole("button", { name: /^\d{4}-\d{2}-\d{2}$/ });
    await expect(days).toHaveCount(42);
    const bounds = (await days.nth(10).boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    await expect(picker).toHaveCSS("animation-name", "none");
    await page.keyboard.press("Escape");
  });
});
