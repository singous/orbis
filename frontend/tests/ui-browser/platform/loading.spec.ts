import { expect, test } from "@playwright/test";

test("generated notebook and editor bones preserve a single accessible loading status", async ({ page }) => {
  await page.goto("/__ui");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const variant of ["cards", "rows", "editor", "editor-body", "compact"]) {
      const preview = page.locator(`[data-loading-preview="${variant}"]`);
      await expect(preview.getByRole("status")).toHaveCount(1);
      const generatesBones = variant === "cards" || variant === "editor-body";
      const bones = preview.locator("[data-boneyard-bone]");
      if (generatesBones) {
        await expect(bones.first()).toBeVisible();
        const overlay = preview.locator("[aria-hidden='true'] [data-boneyard-overlay]");
        await expect(overlay).toHaveCount(1);
        expect((await bones.first().boundingBox())?.width).toBeGreaterThan(0);
      } else {
        await expect(bones).toHaveCount(0);
      }
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  const animations = await page.locator("[data-loading-preview] [data-boneyard-bone], [data-loading-preview] [data-slot='spinner']").evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName));
  expect(animations.length).toBeGreaterThan(0);
  expect(animations.every(name => name === "none")).toBe(true);
});
