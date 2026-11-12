import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  for (const route of ["/login", "/setup", "/__ui"]) {
    test(`accessibility: ${route} in ${theme}`, async ({ page }) => {
      await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const result = await new AxeBuilder({ page }).analyze();
      expect(result.violations).toEqual([]);
      if (route === "/__ui") {
        await page.locator(`section[data-theme="${theme}"]`).getByRole("button", { name: "编辑分组" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await dialog.getByRole("combobox").click();
        await expect(page.getByRole("option").first()).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      }
    });
  }
}
