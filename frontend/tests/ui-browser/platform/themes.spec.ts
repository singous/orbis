import { expect, test } from "@playwright/test";

test("native radii scale with the root font", async ({ page }) => {
  await page.goto("/__ui");
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.dataset.testid = "radius-scale";
    for (const name of ["sm", "md", "lg", "xl"]) {
      const sample = document.createElement("div");
      sample.className = `rounded-${name}`;
      sample.dataset.radius = name;
      host.append(sample);
    }
    document.body.append(host);
  });
  const host = page.getByTestId("radius-scale");
  for (const [fontSize, radii] of [[16, [6, 8, 10, 14]], [20, [7.5, 10, 12.5, 17.5]]] as const) {
    await page.locator("html").evaluate((element, size) => { element.style.fontSize = `${size}px`; }, fontSize);
    for (const [index, name] of ["sm", "md", "lg", "xl"].entries()) await expect(host.locator(`[data-radius="${name}"]`)).toHaveCSS("border-radius", `${radii[index]}px`);
  }
});

for (const outer of ["light", "dark"] as const) {
  test(`nested portals keep their theme inside the ${outer} application`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), outer);
    await page.goto("/__ui");
    const root = page.locator("html");
    await expect(root).toHaveAttribute("data-theme", outer);
    const originalPrimary = await root.evaluate(element => getComputedStyle(element).getPropertyValue("--primary"));
    for (const theme of ["light", "dark"]) {
      const section = page.locator(`section[data-theme="${theme}"]`);
      await section.getByRole("button", { name: "编辑分组" }).click();
      const dialog = page.getByRole("dialog", { name: "编辑分组" });
      await expect(dialog).toBeVisible();
      const colors = await dialog.evaluate(element => ({ theme: element.closest("[data-theme]")?.getAttribute("data-theme"), background: getComputedStyle(element).backgroundColor, foreground: getComputedStyle(element).color }));
      expect(colors.theme).toBe(theme);
      expect(colors.background).not.toBe(colors.foreground);
      await dialog.getByRole("combobox", { name: "分组方式" }).click();
      const option = page.getByRole("option", { name: "按名称" });
      await expect(option).toBeVisible();
      expect(await option.evaluate(element => element.closest("[data-theme]")?.getAttribute("data-theme"))).toBe(theme);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("combobox")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(section.getByRole("button", { name: "编辑分组" })).toBeFocused();
    }
    expect(await root.evaluate(element => getComputedStyle(element).getPropertyValue("--primary"))).toBe(originalPrimary);
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.locator('section[data-theme="light"]').getByRole("button", { name: "编辑分组" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.00001);
    expect(await dialog.evaluate(element => getComputedStyle(element).boxShadow)).toBe("none");
  });
}
