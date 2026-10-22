import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { createCollection, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

async function openSheet(page: Page, request: APIRequestContext) {
  const session = await ownerSession(request);
  const collection = await createCollection(request, session, `表格控件 ${crypto.randomUUID()}`);
  const sheet = await responseData(await request.post(workspacePath(session, "/sheets"), {
    headers: sessionHeaders(session),
    data: { id: crypto.randomUUID(), collection_id: collection.id, title: "界面验收", template: "tasks" },
  }));
  await openWithSession(page, session, `/documents/${sheet.document_id}`);
  await expect(page.getByRole("tab", { name: "表格视图", exact: true })).toBeVisible();
}

async function expectInsideViewport(popover: Locator) {
  await expect.poll(() => popover.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 7 && bounds.top >= 7 && bounds.right <= innerWidth - 7 && bounds.bottom <= innerHeight - 7;
  })).toBe(true);
  expect(await popover.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
}

test("sheet menus restore focus and reposition after resizing and changing field type", async ({ page, request }) => {
  await openSheet(page, request);
  const trigger = page.getByRole("button", { name: "状态列菜单", exact: true });
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("menuitem", { name: "编辑列", exact: true }).click();
  const field = page.getByRole("dialog", { name: "字段设置", exact: true });
  await expectInsideViewport(field);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectInsideViewport(field);
  await page.setViewportSize({ width: 320, height: 500 });
  await expectInsideViewport(field);
  await field.getByRole("textbox", { name: "字段名称", exact: true }).fill("保留的草稿");
  await field.getByLabel("字段类型", { exact: true }).click();
  await page.getByRole("option", { name: "文本", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(field.getByLabel("字段类型", { exact: true })).toBeFocused();
  await expectInsideViewport(field);
  await expect(field.getByRole("textbox", { name: "字段名称", exact: true })).toHaveValue("保留的草稿");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test.describe("touch sheet controls", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("toolbar, row selection, pickers and form actions remain usable on touch", async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openSheet(page, request);
    const controls = await page.locator(".sheet-toolbar > .orbis-action-button").evaluateAll(elements => elements.map(element => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, height: bounds.height, overflow: element.scrollWidth - element.clientWidth };
    }));
    for (const [index, control] of controls.entries()) {
      expect(control.height).toBeGreaterThanOrEqual(44);
      expect(control.overflow).toBeLessThanOrEqual(1);
      if (index) expect(control.left).toBeGreaterThanOrEqual(controls[index - 1].right);
    }
    await expect(page.locator(".sheet-search input")).toHaveCSS("font-size", "16px");
    await page.getByRole("button", { name: "状态列菜单", exact: true }).tap();
    await page.getByRole("menuitem", { name: "编辑列", exact: true }).tap();
    const settings = page.getByRole("dialog", { name: "字段设置", exact: true });
    await expectInsideViewport(settings);
    await expect(settings.getByRole("textbox", { name: "字段名称", exact: true })).toHaveCSS("font-size", "16px");
    const remove = await settings.getByRole("button", { name: "删除选项 1", exact: true }).boundingBox();
    expect(remove!.width).toBeGreaterThanOrEqual(44);
    expect(remove!.height).toBeGreaterThanOrEqual(44);
    await settings.getByRole("button", { name: "取消", exact: true }).tap();
    await expect(settings).toHaveCount(0);
    await page.getByRole("button", { name: "添加记录", exact: true }).first().tap();
    await expect(page.getByText("1 条记录", { exact: true })).toBeVisible();
    await page.locator(".sheet-grid-row .sheet-row-select").first().tap({ position: { x: 3, y: 3 } });
    await expect(page.getByRole("checkbox", { name: "选择记录 1", exact: true })).toBeChecked();
    await page.locator(".sheet-grid-row .sheet-row-select").first().tap({ position: { x: 3, y: 3 } });
    await expect(page.getByRole("checkbox", { name: "选择记录 1", exact: true })).not.toBeChecked();
    await page.getByRole("gridcell").nth(2).tap();
    const picker = page.getByRole("dialog", { name: "日期选择", exact: true });
    await expectInsideViewport(picker);
    await expect(picker).toHaveCSS("animation-name", "none");
    const day = picker.locator(".sheet-calendar-grid > button").nth(10);
    const bounds = await day.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    await day.tap();
    await expect(picker).toHaveCount(0);
    await page.getByRole("button", { name: "生成表单", exact: true }).tap();
    await expect(page.getByRole("button", { name: "预览表单", exact: true })).toBeVisible();
    const tools = page.locator(".sheet-question-tools button");
    expect(await tools.count()).toBeGreaterThan(0);
    const sizes = await tools.evaluateAll(elements => elements.map(element => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }));
    for (const bounds of sizes) {
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});
