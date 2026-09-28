import { expect, test } from "@playwright/test";

test("the supplied theme reaches rendered fields in both color schemes", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  const email = page.getByLabel("邮箱", { exact: true });
  for (const mode of ["light", "dark"] as const) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, mode);
    await email.focus();
    await expect.poll(() => page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(mode === "light" ? "oklch(0.9702 0 0)" : "oklch(0.12 0 0)");
    const rendered = await email.evaluate(async (element) => {
      await document.fonts.ready;
      const field = getComputedStyle(element);
      return {
        background: getComputedStyle(document.body).backgroundColor,
        fieldBackground: field.backgroundColor,
        radius: field.borderRadius,
        focus: field.getPropertyValue("--focus").trim(),
        fieldBorder: field.getPropertyValue("--field-border").trim(),
        outline: field.outlineStyle,
        font: field.fontFamily,
        loadedInter: Array.from(document.fonts).some((font) => font.family.includes("Inter Variable") && font.status === "loaded"),
      };
    });
    expect(rendered.background).toBe(mode === "light" ? "oklch(0.9702 0 0)" : "oklch(0.12 0 0)");
    expect(rendered.fieldBackground).toBe(mode === "light" ? "oklch(1 0 0)" : "oklch(0.2103 0 0)");
    expect(rendered.radius).toBe("8px");
    expect(rendered.focus).toBe(mode === "light" ? "oklch(0 0 0)" : "oklch(0.9848 0 0)");
    expect(rendered.fieldBorder).toBe("transparent");
    expect(rendered.outline).toBe("none");
    expect(rendered.font).toContain("Inter Variable");
    expect(rendered.loadedInter).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`theme-${mode}.png`) });
  }
});
