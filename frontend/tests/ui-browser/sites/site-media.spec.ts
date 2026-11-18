import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { installSiteManagementFixture, siteManagementSiteId } from "../fixtures/site-management";
import { expectNoContinuingMotion, expectVisibleKeyboardFocus } from "../fixtures/media";

const MAX_TAB_STOPS = 80;

async function tabTo(page: Page, target: Locator) {
  for (let stop = 0; stop < MAX_TAB_STOPS && !await target.evaluate(element => element === document.activeElement); stop++) await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
}

for (const profile of [{ theme: "light", width: 1280 }, { theme: "dark", width: 390 }] as const) test.describe(`site media ${profile.theme} ${profile.width}px`, () => {
  test.use({ viewport: { width: profile.width, height: 900 }, hasTouch: profile.width === 390 });
  test("forced colors and reduced motion preserve keyboard creation, nested controls and editor drafts", async ({ page }, info) => {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    const mutations = await installSiteManagementFixture(page, profile.theme);
    const evidence: Record<string, unknown> = { profile, forcedColors: "active", reducedMotion: "reduce" };
    try {
      await page.goto("/sites");
      const create = page.getByRole("button", { name: "创建站点", exact: true });
      await tabTo(page, create);
      evidence.createFocus = await expectVisibleKeyboardFocus(create);
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "创建文档站点", exact: true });
      const name = dialog.getByRole("textbox", { name: "站点名称", exact: true });
      await expect(name).toBeFocused();
      evidence.nameFocus = await expectVisibleKeyboardFocus(name);
      await page.keyboard.type("尚未创建的手册");
      const scenario = dialog.getByRole("combobox", { name: "站点场景", exact: true });
      await tabTo(page, scenario);
      evidence.selectFocus = await expectVisibleKeyboardFocus(scenario);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("option").first()).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      evidence.selectReturnFocus = await expectVisibleKeyboardFocus(scenario);
      const color = dialog.getByRole("button", { name: /选择主题色/ });
      await tabTo(page, color);
      evidence.colorFocus = await expectVisibleKeyboardFocus(color);
      await page.keyboard.press("Enter");
      const picker = page.getByRole("dialog", { name: "选择主题色", exact: true });
      const hex = picker.getByRole("textbox", { name: "十六进制颜色", exact: true });
      await tabTo(page, hex);
      evidence.hexFocus = await expectVisibleKeyboardFocus(hex);
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type("#ABCDEF");
      await page.keyboard.press("Enter");
      await expect(hex).toHaveValue("#ABCDEF");
      evidence.pickerMotion = await expectNoContinuingMotion(picker);
      await page.keyboard.press("Escape");
      await expect(picker).toBeHidden();
      await expect(dialog).toBeVisible();
      evidence.colorReturnFocus = await expectVisibleKeyboardFocus(color);
      evidence.dialogMotion = await expectNoContinuingMotion(dialog);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      evidence.createReturnFocus = await expectVisibleKeyboardFocus(create);
      expect(mutations).toEqual([]);
      const manage = page.getByRole("link", { name: "管理站点 产品手册", exact: true });
      await tabTo(page, manage);
      evidence.manageFocus = await expectVisibleKeyboardFocus(manage);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/sites/${siteManagementSiteId}$`));
      const parent = page.getByRole("checkbox", { name: "公开 开始使用", exact: true });
      const child = page.getByRole("checkbox", { name: "公开 安装客户端", exact: true });
      await expect(parent).toBeChecked();
      await expect(child).toBeChecked();
      await tabTo(page, parent);
      evidence.sourceFocus = await expectVisibleKeyboardFocus(parent);
      await page.keyboard.press("Space");
      await expect(parent).not.toBeChecked();
      await expect(child).not.toBeChecked();
      await expect(child).toBeDisabled();
      await page.keyboard.press("Space");
      await expect(child).toBeChecked();
      const editorName = page.getByRole("textbox", { name: "站点名称", exact: true });
      await tabTo(page, editorName);
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type("保留的站点草稿");
      await expect(editorName).toHaveValue("保留的站点草稿");
      const back = page.getByRole("link", { name: "所有站点", exact: true });
      await tabTo(page, back);
      evidence.backFocus = await expectVisibleKeyboardFocus(back);
      await page.keyboard.press("Enter");
      const guard = page.getByRole("dialog", { name: "站点设置尚未保存", exact: true });
      const keep = guard.getByRole("button", { name: "继续编辑", exact: true });
      await tabTo(page, keep);
      evidence.guardFocus = await expectVisibleKeyboardFocus(keep);
      evidence.guardMotion = await expectNoContinuingMotion(guard);
      await page.keyboard.press("Enter");
      await expect(guard).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`/sites/${siteManagementSiteId}$`));
      await expect(editorName).toHaveValue("保留的站点草稿");
      expect(mutations).toEqual([]);
      evidence.editorMotion = await expectNoContinuingMotion(page.locator('[data-ui="site-management"]'));
      const accessibility = await new AxeBuilder({ page }).analyze();
      evidence.axe = accessibility.violations;
      expect(accessibility.violations).toEqual([]);
    } finally {
      await info.attach("site-media", { body: JSON.stringify({ ...evidence, mutations }, null, 2), contentType: "application/json" });
    }
  });
});
