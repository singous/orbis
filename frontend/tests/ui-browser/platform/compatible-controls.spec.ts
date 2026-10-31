import { expect, test } from "@playwright/test";

for (const touch of [false, true]) {
  test.describe(touch ? "touch compatibility controls" : "desktop compatibility controls", () => {
    test.use({ hasTouch: touch, viewport: { width: touch ? 390 : 1280, height: 900 } });
    for (const theme of ["light", "dark"]) {
      test(`${theme} keeps control geometry, focus and legacy pending behavior`, async ({ page }) => {
        await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
        await page.goto("/__ui");
        const controls = page.getByRole("region", { name: "兼容控件" });
        await controls.scrollIntoViewIfNeeded();
        await page.evaluate(() => document.fonts.ready);
        const metrics = await controls.evaluate(element => {
          const read = (selector: string) => {
            const item = element.querySelector<HTMLElement>(selector)!;
            const css = getComputedStyle(item);
            return { height: item.getBoundingClientRect().height, width: item.getBoundingClientRect().width, radius: css.borderRadius, fontSize: css.fontSize, padding: css.paddingLeft };
          };
          return { primary: read('[data-testid="compatible-primary"]'), compact: read('[data-testid="compatible-compact"]'), input: read('input'), select: read('[role="combobox"]'), point: read('[aria-label="兼容连接点"]'), gridPoint: read('[aria-label="网格内连接点"]'), icon: read('[aria-label="兼容图标操作"]') };
        });
        expect(metrics.primary).toMatchObject({ height: touch ? 44 : 36, radius: "12px", fontSize: "14px", padding: "12px" });
        expect(metrics.compact).toMatchObject({ height: touch ? 44 : 32, radius: "12px", padding: "10px" });
        expect(metrics.input).toMatchObject({ height: touch ? 44 : 40, radius: "8px", fontSize: touch ? "16px" : "14px" });
        expect(metrics.select.height).toBe(touch ? 44 : 40);
        expect(metrics.icon.height).toBe(touch ? 44 : 32);
        expect(metrics.point.height).toBe(touch ? 44 : 12);
        expect(metrics.gridPoint.height).toBe(12);
        const itemColor = await controls.evaluate(element => {
          const sample = document.createElement("span");
          sample.style.color = "var(--ob-item-foreground)";
          element.append(sample);
          const color = getComputedStyle(sample).color;
          sample.remove();
          return color;
        });
        const iconAction = controls.getByRole("button", { name: "兼容图标操作" });
        await iconAction.hover();
        await expect(iconAction).toHaveCSS("color", itemColor);
        await iconAction.focus();
        await expect(iconAction).toHaveCSS("color", itemColor);
        const nativeIcon = controls.getByRole("button", { name: "原生图标操作" });
        await expect(nativeIcon).toHaveCSS("height", touch ? "44px" : "32px");
        await nativeIcon.hover();
        await expect(nativeIcon).toHaveCSS("color", itemColor);
        await nativeIcon.click();
        await expect(nativeIcon).toHaveAttribute("aria-pressed", "true");
        await page.mouse.move(0, 0);
        await expect(nativeIcon).toHaveCSS("color", itemColor);
        const nativeDisabled = controls.getByRole("button", { name: "原生禁用操作" });
        await expect(nativeDisabled).toBeDisabled();
        await expect(nativeDisabled).toHaveCSS("opacity", "0.28");
        const nativeText = controls.getByRole("button", { name: "原生文字操作" });
        await expect(nativeText).toHaveCSS("height", touch ? "44px" : "36px");
        await expect(nativeText).toHaveCSS("font-size", "14px");
        await expect(nativeIcon.locator("svg")).toHaveCSS("width", "14px");
        const input = controls.getByRole("textbox", { name: "兼容名称" });
        await input.focus();
        expect(await input.evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth }))).toEqual({ style: "solid", width: "2px" });
        const disabled = controls.getByRole("button", { name: "兼容禁用" });
        await expect(disabled).toBeDisabled();
        await disabled.focus();
        await expect(disabled).not.toBeFocused();
        await controls.getByRole("button", { name: "开始兼容操作" }).click();
        const pending = controls.getByRole("button", { name: "兼容处理中" });
        await expect(pending).toBeDisabled();
        await expect(pending).toHaveAttribute("aria-busy", "true");
        await page.keyboard.press("Enter");
        await expect(controls.getByRole("status", { name: "兼容激活次数" })).toHaveText("1");
        await controls.getByRole("button", { name: "结束兼容操作" }).click();
        await controls.getByRole("combobox", { name: "兼容分组" }).click();
        await page.getByRole("option", { name: "兼容不分组", exact: true }).click();
        await expect(controls.getByRole("status", { name: "兼容选择" })).toHaveText("（空值）");
        await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
        await input.focus();
        expect(await input.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");
        expect(await input.evaluate(element => getComputedStyle(element).boxShadow)).toBe("none");
      });
    }
  });
}
