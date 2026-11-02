import { notification } from "../helpers/notifications";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { createCollection, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

const MIN_NATIVE_TARGET_PX = 24;

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
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(field.getByLabel("字段类型", { exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(field.getByLabel("字段类型", { exact: true })).toBeFocused();
  await expectInsideViewport(field);
  await expect(field.getByRole("textbox", { name: "字段名称", exact: true })).toHaveValue("保留的草稿");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const kind of ["field", "view"] as const) {
  test(`${kind} settings keep unsaved changes through toast dismissal and repeated save failures`, async ({ page, request }) => {
    await openSheet(page, request);
    let attempts = 0;
    await page.route("**/api/v1/workspaces/*/sheets/*", async route => {
      if (route.request().method() !== "PUT") { await route.continue(); return; }
      attempts += 1;
      await route.fulfill({
        status: 422,
        json: { code: "VALIDATION_ERROR", message: "保存设置失败，请重试", request_id: `settings-toast-${attempts}`, data: null },
      });
    });
    if (kind === "field") {
      await page.getByRole("button", { name: "状态列菜单", exact: true }).click();
      await page.getByRole("menuitem", { name: "编辑列", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "字段管理", exact: true }).click();
    }
    const popover = page.getByRole("dialog", { name: kind === "field" ? "字段设置" : "字段管理", exact: true });
    if (kind === "field") {
      await popover.getByRole("textbox", { name: "字段名称", exact: true }).fill("未保存的状态列");
    } else {
      await popover.getByRole("checkbox", { name: "日期", exact: true }).uncheck();
    }
    const save = popover.getByRole("button", { name: kind === "field" ? "保存字段" : "应用", exact: true });
    const notice = notification(page, "保存设置失败，请重试");
    const expectDraft = async () => {
      await expect(popover).toBeVisible();
      if (kind === "field") await expect(popover.getByRole("textbox", { name: "字段名称", exact: true })).toHaveValue("未保存的状态列");
      else await expect(popover.getByRole("checkbox", { name: "日期", exact: true })).not.toBeChecked();
    };
    await save.click();
    await expect(notice).toContainText("保存设置失败，请重试");
    await expect(page.locator('[data-slot="toast"]')).toHaveCount(1);
    await expect(notice.locator("button")).toHaveCount(1);
    await notice.hover();
    await notice.locator('[data-slot="toast-close"]').click();
    await expect(notice).toHaveCount(0);
    await expectDraft();
    await save.click();
    await expect(notice).toContainText("保存设置失败，请重试");
    await page.mouse.move(0, 0);
    await expect(notice).toHaveCount(0);
    await expectDraft();
    await save.click();
    await expect(notice).toContainText("保存设置失败，请重试");
    expect(attempts).toBe(3);
    await popover.getByRole("button", { name: "取消", exact: true }).click();
    await expect(popover).toHaveCount(0);
  });
}

test.describe("touch sheet controls", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("toolbar, row selection and pickers remain usable on touch with deferred forms hidden", async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openSheet(page, request);
    const toolbarControls = page.locator(".sheet-toolbar > button");
    await expect(toolbarControls).toHaveCount(6);
    const controls = await toolbarControls.evaluateAll(elements => elements.map(element => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height, overflow: element.scrollWidth - element.clientWidth };
    }));
    expect(controls).toHaveLength(6);
    for (const [index, control] of controls.entries()) {
      expect(control.width).toBeGreaterThanOrEqual(MIN_NATIVE_TARGET_PX);
      expect(control.height).toBeGreaterThanOrEqual(MIN_NATIVE_TARGET_PX);
      expect(control.overflow).toBeLessThanOrEqual(1);
      for (const previous of controls.slice(0, index)) {
        const overlapWidth = Math.min(control.right, previous.right) - Math.max(control.left, previous.left);
        const overlapHeight = Math.min(control.bottom, previous.bottom) - Math.max(control.top, previous.top);
        expect(overlapWidth <= 0 || overlapHeight <= 0).toBe(true);
      }
    }
    await expect(page.getByRole("textbox", { name: "搜索记录", exact: true })).toHaveCSS("font-size", "16px");
    for (const name of ["字段管理", "筛选", "分组", "排序", "行高"]) {
      const control = page.getByRole("button", { name, exact: true });
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
      await control.tap();
      const dialog = page.getByRole("dialog", { name, exact: true });
      await expectInsideViewport(dialog);
      await dialog.getByRole("button", { name: "取消", exact: true }).tap();
      await expect(dialog).toHaveCount(0);
    }
    await page.getByRole("button", { name: "状态列菜单", exact: true }).tap();
    await page.getByRole("menuitem", { name: "编辑列", exact: true }).tap();
    const settings = page.getByRole("dialog", { name: "字段设置", exact: true });
    await expectInsideViewport(settings);
    await expect(settings.getByRole("textbox", { name: "字段名称", exact: true })).toHaveCSS("font-size", "16px");
    const remove = settings.getByRole("button", { name: "删除选项 1", exact: true });
    const removeBounds = (await remove.boundingBox())!;
    expect(removeBounds.width).toBeGreaterThanOrEqual(MIN_NATIVE_TARGET_PX);
    expect(removeBounds.height).toBeGreaterThanOrEqual(MIN_NATIVE_TARGET_PX);
    const options = settings.getByRole("textbox", { name: /^选项 \d+$/ });
    const optionCount = await options.count();
    await remove.tap();
    await expect(options).toHaveCount(optionCount - 1);
    await settings.getByRole("button", { name: "取消", exact: true }).tap();
    await expect(settings).toHaveCount(0);
    await page.getByRole("button", { name: "添加记录", exact: true }).first().tap();
    await expect(page.getByText("1 条记录", { exact: true })).toBeVisible();
    await page.locator(".sheet-grid-row .sheet-row-select").first().tap({ position: { x: 3, y: 3 } });
    await expect(page.getByRole("checkbox", { name: "选择记录 1", exact: true })).toBeChecked();
    await page.locator(".sheet-grid-row .sheet-row-select").first().tap({ position: { x: 3, y: 3 } });
    await expect(page.getByRole("checkbox", { name: "选择记录 1", exact: true })).not.toBeChecked();
    const dateCell = page.getByRole("gridcell").nth(2);
    const picker = page.getByRole("dialog", { name: "日期选择", exact: true });
    await dateCell.tap();
    await expect(dateCell).toHaveAttribute("aria-selected", "true");
    await expect(picker).toHaveCount(0);
    await dateCell.tap();
    await dateCell.tap();
    await expect(picker).toBeVisible();
    await expectInsideViewport(picker);
    await expect(picker).toHaveCSS("animation-name", "none");
    const day = picker.getByRole("button", { name: /^\d{4}-\d{2}-\d{2}$/ }).nth(10);
    const bounds = await day.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    await day.tap();
    await expect(picker).toHaveCount(0);
    await expect(page.getByRole("button", { name: "生成表单", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "添加视图", exact: true }).tap();
    await expect(page.getByRole("menuitem", { name: "表单", exact: true })).toHaveCount(0);
    const item = page.getByRole("menuitem", { name: "看板视图", exact: true });
    const menuBounds = await item.boundingBox();
    expect(menuBounds!.height).toBeGreaterThanOrEqual(MIN_NATIVE_TARGET_PX);
    expect(menuBounds!.width).toBeGreaterThanOrEqual(MIN_NATIVE_TARGET_PX);
    await expect(item).toBeInViewport();
    expect(await item.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return hit !== null && element.contains(hit);
    })).toBe(true);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});
