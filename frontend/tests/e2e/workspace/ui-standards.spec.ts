import { expect, test } from "@playwright/test";
import { createCollection, openWithSession, ownerSession } from "../helpers/api-fixtures";

test("keyboard users can bypass navigation and continue in the main workspace", async ({ page, request }) => {
  const session = await ownerSession(request);
  await openWithSession(page, session, "/sites");
  await expect(page.getByRole("button", { name: "创建站点", exact: true })).toBeVisible();

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "跳转到主内容", exact: true });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace-main-content")).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await page.locator("#workspace-main-content").evaluate(element => element.contains(document.activeElement))).toBe(true);
});

test("notebook icon and color choices expose a visible keyboard focus ring", async ({ page, request }) => {
  const session = await ownerSession(request);
  const notebook = await createCollection(request, session, "图标键盘验收");
  await openWithSession(page, session, `/collections/${notebook.id}`);
  await page.getByRole("button", { name: "笔记本操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "编辑笔记本", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑笔记本", exact: true });
  for (const name of ["预设图标", "图标颜色"]) {
    const group = dialog.getByRole("radiogroup", { name, exact: true });
    await group.getByRole("radio").first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(group.getByRole("radio").nth(1)).toBeFocused();
    const focused = group.locator('[data-slot="radio-content"][data-focus-visible="true"]');
    await expect(focused).toHaveCSS("outline-style", "solid");
    await expect(focused).toHaveCSS("outline-width", "2px");
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "笔记本操作", exact: true })).toBeFocused();
});

test("a selector inside a dialog remains clickable above its backdrop", async ({ page, request }) => {
  const session = await ownerSession(request);
  await openWithSession(page, session, "/sites");
  await page.getByRole("button", { name: "创建站点", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建文档站点", exact: true });
  const field = dialog.locator(".orbis-select-field").filter({ has: page.getByText("站点场景", { exact: true }) });
  const trigger = field.getByRole("button");
  await trigger.click();
  const option = page.getByRole("listbox").getByRole("option").last();
  const label = await option.innerText();
  await option.click();
  await expect(trigger).toContainText(label.trim());
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await trigger.press("ArrowDown");
  await page.getByRole("listbox").press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "创建站点", exact: true })).toBeFocused();
});

test.describe("touch controls", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("notebook choices remain tappable and dialog actions stay reachable on narrow screens", async ({ page, request }) => {
    const session = await ownerSession(request);
    const notebook = await createCollection(request, session, "触屏控件验收");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWithSession(page, session, `/collections/${notebook.id}`);

    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 560 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole("button", { name: "笔记本操作", exact: true }).tap();
      await page.getByRole("menuitem", { name: "编辑笔记本", exact: true }).tap();
      const dialog = page.getByRole("dialog", { name: "编辑笔记本", exact: true });
      await expect(dialog).toBeVisible();
      const choices = await dialog.locator('.notebook-icon-picker [data-slot="radio-content"]').evaluateAll(elements => elements.map(element => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }));
      expect(choices.length).toBeGreaterThan(16);
      for (const choice of choices) {
        expect(choice.width).toBeGreaterThanOrEqual(44);
        expect(choice.height).toBeGreaterThanOrEqual(44);
      }
      const color = dialog.getByRole("radiogroup", { name: "图标颜色", exact: true }).getByRole("radio").nth(2);
      await dialog.locator(".notebook-icon-color-choice").nth(2).tap({ position: { x: 3, y: 3 } });
      await expect(color).toBeChecked();
      const icon = dialog.getByRole("radiogroup", { name: "预设图标", exact: true }).getByRole("radio").nth(1);
      await dialog.locator(".notebook-icon-choice").nth(1).tap();
      await expect(icon).toBeChecked();
      expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      const save = dialog.getByRole("button", { name: "保存", exact: true });
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeInViewport();
      await save.tap();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "触屏控件验收", exact: true })).toBeVisible();
    }
  });
});
