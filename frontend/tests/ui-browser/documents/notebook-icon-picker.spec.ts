import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installSession, user } from "../fixtures/session";

const pageData = (items: unknown[]) => ({ items, pagination: { page: 1, page_size: 20, total: items.length } });
test.beforeEach(async ({ page }) => {
  await installSession(page);
  await page.route("**/api/v1/**", route => route.fulfill({ json: { code: "OK", message: "", request_id: "notebook-icon-ui", data: new URL(route.request().url()).pathname === "/api/v1/me" ? user : pageData([]) } }));
});

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) {
  test(`notebook picker ${theme} at ${width}px keeps choices and radio keyboard behavior`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/documents");
    await page.getByRole("button", { name: "新建笔记本", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "新建笔记本", exact: true });
    const icons = dialog.getByRole("radiogroup", { name: "预设图标", exact: true });
    const colors = dialog.getByRole("radiogroup", { name: "图标颜色", exact: true });
    await expect(dialog.getByRole("textbox", { name: "笔记本名称", exact: true })).toBeFocused();
    await expect(icons.locator('[data-slot="radio-group-item"]')).toHaveCount(await icons.getByRole("radio").count());
    await expect(icons.locator("label .notebook-icon").first()).toBeVisible();
    await expect(colors.locator("label .notebook-icon-swatch").first()).toBeVisible();
    for (const group of [icons, colors]) expect(await group.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const first = icons.getByRole("radio").first();
    const last = icons.getByRole("radio").last();
    await first.focus();
    await page.keyboard.press("End");
    await expect(last).toBeFocused();
    await expect(last).toBeChecked();
    await expect(last).toBeFocused();
    await page.keyboard.press("Home");
    await expect(first).toBeChecked();
    await colors.getByRole("radio").first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(colors.getByRole("radio").nth(1)).toBeChecked();
    await dialog.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
    expect((await new AxeBuilder({ page }).include(".notebook-dialog").analyze()).violations).toEqual([]);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: "上传自定义图标", exact: true }).click();
    await (await chooser).setFiles([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
}

test.describe("notebook picker coarse pointer", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 900 } });
  test("keeps every labelled radio choice operable within the dialog", async ({ page }) => {
    await page.goto("/documents");
    await page.getByRole("button", { name: "新建笔记本", exact: true }).first().tap();
    const dialog = page.getByRole("dialog", { name: "新建笔记本", exact: true });
    for (const groupName of ["预设图标", "图标颜色"]) {
      const group = dialog.getByRole("radiogroup", { name: groupName, exact: true });
      const labels = group.locator("label");
      await expect(labels).toHaveCount(await group.getByRole("radio").count());
      for (let index = 0; index < await labels.count(); index++) {
        await labels.nth(index).tap();
        await expect(group.getByRole("radio").nth(index)).toBeChecked();
      }
      expect(await group.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
});

test("notebook icon upload pending state preserves the chosen image and disables save until receipt", async ({ page }) => {
  let finishUpload!: () => void;
  const uploading = new Promise<void>(resolve => { finishUpload = resolve; });
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jcoQAAAAASUVORK5CYII=", "base64");
  await page.route("**/collection-icons", async route => {
    await uploading;
    await route.fulfill({ json: { code: "OK", message: "", request_id: "icon-upload", data: { id: "00000000-0000-4000-8000-000000000012" } } });
  });
  await page.route("**/assets/*/content", route => route.fulfill({ contentType: "image/png", body: image }));
  await page.goto("/documents");
  await page.getByRole("button", { name: "新建笔记本", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "新建笔记本", exact: true });
  await dialog.getByRole("textbox", { name: "笔记本名称", exact: true }).fill("图标上传");
  await dialog.locator('input[type="file"]').setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: image });
  try {
    await expect(dialog.getByRole("button", { name: "正在上传图片…", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "上传中…", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("radio").first()).toHaveAttribute("aria-disabled", "true");
  } finally { finishUpload(); }
  await expect(dialog.getByRole("img", { name: "自定义笔记本图标", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "创建", exact: true })).toBeEnabled();
});


test("notebook picker keeps checked choice and focus visible with forced colors and reduced motion", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/documents");
  await page.getByRole("button", { name: "新建笔记本", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "新建笔记本", exact: true });
  const choice = dialog.getByRole("radiogroup", { name: "预设图标", exact: true }).getByRole("radio").first();
  await choice.focus();
  await page.keyboard.press("Home");
  await expect(choice).toBeChecked();
  expect(await choice.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
  expect(await choice.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await expect(choice).toHaveCSS("border-width", "1px");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
