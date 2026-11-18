import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) test(`catalog command composition keeps its ${theme} input, selected option and focus contract`, async ({ page }) => {
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  await page.goto("/__ui");
  const trigger = page.getByRole("button", { name: "预览搜索组合", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "搜索组合示例", exact: true });
  const input = dialog.getByRole("combobox", { name: "示例搜索", exact: true });
  const option = dialog.getByRole("option", { name: /搜索展示契约/ });
  await expect(input).toBeFocused();
  await input.fill("组件");
  await expect(input).toHaveValue("组件");
  await expect(input).toHaveAttribute("aria-controls", await dialog.getByRole("listbox").getAttribute("id") ?? "");
  await expect(input).toHaveAttribute("aria-activedescendant", await option.getAttribute("id") ?? "");
  await expect(option).toHaveAttribute("aria-selected", "true");
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await option.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
