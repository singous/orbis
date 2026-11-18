import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("color field preserves CSS values, hex drafts, IME and native picker commit boundaries", async ({ page }) => {
  await page.goto("/__ui");
  const section = page.locator('section[data-theme="light"]');
  const selected = section.getByRole("status", { name: "已选颜色" });
  const commits = section.getByRole("status", { name: "颜色提交次数" });
  const trigger = section.getByRole("button", { name: /选择示例颜色/ });
  for (const [label, original, expected] of [
    ["RGB", "rgb(18, 52, 86)", "#123456"],
    ["HSL", "hsl(120, 100%, 50%)", "#00FF00"],
    ["HSB", "hsb(240, 100%, 100%)", "#0000FF"],
    ["带透明度的十六进制", "#12345680", "#123456"],
  ]) {
    await section.getByRole("combobox", { name: "颜色格式" }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
    await trigger.click();
    const popup = page.getByRole("dialog", { name: /选择示例颜色/ });
    await expect(popup.getByRole("textbox", { name: "十六进制颜色" })).toHaveValue(expected);
    await page.keyboard.press("Escape");
    await expect(selected).toHaveText(original);
  }
  await trigger.click();
  const popup = page.getByRole("dialog", { name: /选择示例颜色/ });
  const input = popup.getByRole("textbox", { name: "十六进制颜色" });
  await input.fill("abc");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(selected).toHaveText("#12345680");
  await input.press("Enter");
  await expect(selected).toHaveText("#AABBCC");
  await input.fill("invalid");
  await input.press("Tab");
  await expect(selected).toHaveText("#AABBCC");
  await expect(popup).toHaveCount(0);
  await trigger.click();
  await expect(input).toHaveValue("#AABBCC");
  const area = popup.getByRole("slider", { name: "饱和度与亮度" });
  const bounds = (await area.boundingBox())!;
  expect(bounds.height).toBeGreaterThan(0);
  const previousCommits = Number(await commits.textContent());
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await expect(selected).not.toHaveText("#AABBCC");
  await expect(commits).toHaveText(String(previousCommits));
  await page.mouse.up();
  await expect(commits).toHaveText(String(previousCommits + 1));
  const hue = popup.getByRole("slider", { name: "色相" });
  await hue.focus();
  await page.keyboard.down("ArrowRight");
  await expect(commits).toHaveText(String(previousCommits + 1));
  await page.keyboard.up("ArrowRight");
  await expect(commits).toHaveText(String(previousCommits + 2));
  expect((await new AxeBuilder({ page }).include('[data-slot="popover-content"]').analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("rejects an overlong pasted hex value as a whole without clipping it into a different color", async ({ page }) => {
  await page.goto("/__ui");
  const light = page.locator('section[data-theme="light"]');
  await light.getByRole("combobox", { name: "颜色格式" }).click();
  await page.getByRole("option", { name: "带透明度的十六进制", exact: true }).click();
  await expect(light.getByRole("status", { name: "已选颜色" })).toHaveText("#12345680");
  await light.getByRole("button", { name: /选择示例颜色/ }).click();
  const input = page.getByRole("textbox", { name: "十六进制颜色" });
  await expect(input).toHaveValue("#123456");
  await input.fill("#abcdef78");
  await expect(input).toHaveValue("#123456");
  await input.press("Enter");
  await expect(light.getByRole("status", { name: "已选颜色" })).toHaveText("#12345680");
});

test("a color picker inside a dialog closes one layer at a time and returns focus", async ({ page }) => {
  await page.goto("/__ui");
  const section = page.locator('section[data-theme="light"]');
  await section.getByRole("button", { name: "编辑分组" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑分组", exact: true });
  const trigger = dialog.getByRole("button", { name: /选择浮层颜色/ });
  await trigger.click();
  const picker = page.getByRole("dialog", { name: "选择浮层颜色", exact: true });
  await expect(picker).toBeVisible();
  const input = picker.getByRole("textbox", { name: "十六进制颜色" });
  await input.fill("#abcdef");
  await input.press("Enter");
  await expect(input).toHaveValue("#ABCDEF");
  await input.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(section.getByRole("button", { name: "编辑分组" })).toBeFocused();
  await expect(section.getByRole("status", { name: "已选颜色" })).toHaveText("#ABCDEF");
});
