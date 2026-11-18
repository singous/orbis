import { expect, test } from "@playwright/test";
import { expectVisibleKeyboardFocus } from "../fixtures/media";

for (const touch of [false, true]) {
  test.describe(touch ? "touch native controls" : "desktop native controls", () => {
    test.use({ hasTouch: touch, viewport: { width: touch ? 390 : 1280, height: 900 } });
    for (const theme of ["light", "dark"]) {
      test(`${theme} keeps native sizing, focus and pending semantics`, async ({ page }) => {
        await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto("/__ui");
        const controls = page.getByRole("region", { name: "原生控件" });
        await controls.scrollIntoViewIfNeeded();
        await page.evaluate(() => document.fonts.ready);
        const primary = controls.getByTestId("native-primary");
        const compact = controls.getByTestId("native-compact");
        await expect(primary).toHaveAttribute("data-slot", "button");
        await expect(primary).toHaveCSS("height", "32px");
        await expect(compact).toHaveCSS("height", "28px");
        const icon = controls.getByRole("button", { name: "图标操作", exact: true });
        await icon.click();
        await expect(icon).toHaveAttribute("aria-pressed", "true");
        const input = controls.getByRole("textbox", { name: "普通字段" });
        await input.focus();
        await expectVisibleKeyboardFocus(input);
        const disabled = controls.getByRole("button", { name: "不可用", exact: true });
        await expect(disabled).toBeDisabled();
        await disabled.focus();
        await expect(disabled).not.toBeFocused();
        await controls.getByRole("button", { name: "开始操作", exact: true }).click();
        const pending = controls.getByRole("button", { name: "处理中", exact: true });
        await expect(pending).toHaveAttribute("aria-disabled", "true");
        await expect(pending).toHaveAttribute("aria-busy", "true");
        await expect(pending).toBeFocused();
        await page.keyboard.press("Enter");
        await pending.click({ force: true });
        await expect(controls.getByRole("status", { name: "激活次数" })).toHaveText("1");
        await controls.getByRole("button", { name: "结束操作", exact: true }).click();
        await expect(controls.getByRole("button", { name: "开始操作", exact: true })).toBeEnabled();
        const group = controls.getByRole("combobox", { name: "分组", exact: true });
        await group.click();
        await page.getByRole("option", { name: "按名称", exact: true }).click();
        await expect(controls.getByRole("status", { name: "选择", exact: true })).toHaveText("name");
        await group.click();
        await page.getByRole("option", { name: "不分组", exact: true }).click();
        await expect(controls.getByRole("status", { name: "选择", exact: true })).toHaveText("（空值）");
        await page.emulateMedia({ forcedColors: "active" });
        await input.focus();
        await expectVisibleKeyboardFocus(input);
        await expect(input).toHaveCSS("box-shadow", "none");
      });
    }
  });
}
