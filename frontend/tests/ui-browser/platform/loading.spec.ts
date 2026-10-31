import { expect, test } from "@playwright/test";

test("loading placeholders retain variant geometry, one status and reduced motion", async ({ page }, info) => {
  await page.goto("/__ui");
  await expect(page.locator('[data-loading-preview="rows"]')).toBeVisible();
  const measurements = [];
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const variant of ["cards", "rows", "editor", "editor-body", "compact"]) {
      const preview = page.locator(`[data-loading-preview="${variant}"]`);
      await expect(preview.getByRole("status")).toHaveCount(1);
      const metrics = await preview.evaluate(element => {
        const layout = element.querySelector(".loading-layout")!;
        const firstLine = element.querySelector(".loading-line")!;
        const item = element.querySelector(".loading-item");
        const icon = element.querySelector(".loading-icon");
        const css = getComputedStyle(layout);
        return { columns: css.gridTemplateColumns.split(" ").length, gap: css.gap, minHeight: css.minHeight, lineHeight: firstLine.getBoundingClientRect().height, lineRadius: getComputedStyle(firstLine).borderRadius, itemHeight: item?.getBoundingClientRect().height, iconSize: icon?.getBoundingClientRect().width };
      });
      measurements.push({ width, variant, ...metrics });
      expect(metrics.columns).toBe(variant === "cards" && width === 1280 ? 2 : 1);
      expect(metrics.lineHeight).toBe(variant === "editor" ? 30 : variant === "editor-body" ? 10 : 12);
      expect(metrics.lineRadius).toBe("4px");
      if (variant === "compact") expect([metrics.itemHeight, metrics.iconSize]).toEqual([48, 22]);
      if (variant === "rows") expect([metrics.itemHeight, metrics.iconSize]).toEqual([74, 32]);
      if (variant === "cards") expect([metrics.itemHeight, metrics.iconSize]).toEqual([96, 32]);
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  const animations = await page.locator("[data-loading-preview] [data-slot='ob-skeleton'], [data-loading-preview] [data-slot='ob-spinner']").evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName));
  expect(animations.every(name => name === "none")).toBe(true);
  await info.attach("loading-layout-metrics", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
});
