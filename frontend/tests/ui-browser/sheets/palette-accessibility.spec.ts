import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readContrasts } from "../fixtures/contrast";
import { documentId } from "../fixtures/document-editor";
import { installSheetRouteFixture, sheetRoutePath } from "../fixtures/sheet-route";
import { initialSheet, records } from "../fixtures/sheet-workspace";

const presets = ["gray", "blue", "green", "amber", "purple", "pink"] as const;

for (const theme of ["light", "dark"] as const) for (const width of [1280, 390]) test.describe(`${theme} ${width}px Sheet preset labels`, () => {
  test.use({ hasTouch: width === 390 });
  test("keeps every preset readable in real cells without changing its background", async ({ page }, info) => {
    await installSheetRouteFixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    const options = presets.map(color => ({ id: color, label: color, color }));
    const sheet = {
      ...initialSheet,
      id: documentId,
      definition: {
        ...initialSheet.definition,
        fields: initialSheet.definition.fields.map(field => field.id === "status" ? { ...field, options } : field),
      },
    };
    const rows = presets.map((preset, index) => ({
      ...records[0],
      id: `00000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
      position: index,
      values: { name: `示例 ${preset} 标签`, status: preset, number: index },
    }));
    await page.route("**/api/v1/workspaces/*/sheets/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.endsWith(`/${documentId}`) && !path.endsWith("/records") && !path.endsWith("/stats")) return route.fallback();
      expect(route.request().method()).toBe("GET");
      const data = path.endsWith("/records") ? { items: rows, next_cursor: "", schema_version: sheet.schema_version, duplicate_ids: {} }
        : path.endsWith("/stats") ? { total: rows.length, groups: [] } : sheet;
      await route.fulfill({ json: { code: "OK", message: "", request_id: "sheet-preset-accessibility", data } });
    });
    const paints: unknown[] = [];
    const evidence: Record<string, unknown> = { theme, width, forcedColors: "none", paints };
    try {
      await page.goto(sheetRoutePath);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".sheet-tag")).toHaveCount(presets.length);
      for (const preset of presets) {
        const tag = page.locator(".sheet-tag").getByText(preset, { exact: true });
        await tag.scrollIntoViewIfNeeded();
        await expect(tag).toBeVisible();
        await expect(tag).toBeInViewport();
        const painted = await tag.evaluate(element => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return { box: { width: box.width, height: box.height }, unobscured: hit !== null && element.contains(hit) };
        });
        expect(painted.unobscured).toBe(true);
        const [contrast] = await readContrasts(tag, [null]);
        paints.push({ preset, ...painted, ...contrast });
        expect(contrast.ratio, `${theme} ${width}px ${preset}: ${JSON.stringify(contrast)}`).toBeGreaterThanOrEqual(4.5);
      }
      const accessibility = await new AxeBuilder({ page }).analyze();
      evidence.axe = accessibility.violations;
      expect(accessibility.violations).toEqual([]);
    } finally {
      await info.attach("sheet-preset-accessibility", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
    }
  });
});
