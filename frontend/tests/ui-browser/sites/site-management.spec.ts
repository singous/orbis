import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installSiteManagementFixture } from "../fixtures/site-management";

for (const theme of ["light", "dark"] as const) for (const width of [1280, 390]) {
  test.describe(`${theme} ${width}px`, () => {
  test.use({ hasTouch: width === 390 });
  test(`site management keeps ${theme} ${width}px layout, source exclusion and draft navigation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const mutations = await installSiteManagementFixture(page, theme);
    await page.goto("/sites");
    const create = page.getByRole("button", { name: "创建站点", exact: true });
    await create.click();
    const dialog = page.getByRole("dialog", { name: "创建文档站点" });
    await expect(dialog.getByRole("textbox", { name: "站点名称", exact: true })).toBeFocused();
    await expect(dialog.getByRole("textbox", { name: "站点名称", exact: true })).toHaveValue("");
    await dialog.getByRole("textbox", { name: "站点名称", exact: true }).fill("尚未创建的手册");
    expect(mutations).toHaveLength(0);
    const bounds = await dialog.boundingBox();
    expect(bounds?.width).toBe(width === 1280 ? 860 : 350);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(create).toBeFocused();
    await page.getByRole("link", { name: "管理站点 产品手册" }).click();
    const parentCheck = page.getByRole("checkbox", { name: "公开 开始使用", exact: true });
    const childCheck = page.getByRole("checkbox", { name: "公开 安装客户端", exact: true });
    await expect(parentCheck).toBeChecked();
    await expect(childCheck).toBeChecked();
    await parentCheck.click();
    await expect(parentCheck).not.toBeChecked();
    await expect(childCheck).not.toBeChecked();
    await expect(childCheck).toBeDisabled();
    await parentCheck.click();
    await expect(childCheck).toBeChecked();
    const details = page.getByRole("button", { name: "设置 开始使用 的公开信息" });
    const detailBounds = await details.boundingBox();
    expect(detailBounds?.width).toBe(width === 390 ? 44 : 32);
    expect(detailBounds?.height).toBe(width === 390 ? 44 : 32);
    await details.click();
    const title = page.getByRole("textbox", { name: "公开标题：开始使用", exact: true });
    await title.fill("待保存的公开标题");
    await page.getByRole("link", { name: "所有站点", exact: true }).click();
    const guard = page.getByRole("dialog", { name: "站点设置尚未保存" });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(guard).toHaveCount(0);
    await expect(title).toHaveValue("待保存的公开标题");
    await expect(page.getByRole("link", { name: "查看公开站点" })).toHaveAttribute("href", "/s/guide");
    expect(mutations).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const accessibility = await new AxeBuilder({ page }).include('[data-ui="site-management"]').analyze();
    expect(accessibility.violations).toEqual([]);
    expect(await page.locator(".site-editor-layout").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(width === 1280 ? 2 : 1);
  });
  });
}
