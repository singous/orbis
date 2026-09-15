import { expect, test } from "@playwright/test";

const viewports = [
  { width: 1391, height: 923 },
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 1000 },
  { width: 390, height: 1000 },
];

for (const route of ["login", "setup"]) {
  for (const viewport of viewports) {
    test(`${route} keeps readable, centered auth content at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/${route}`);
      await expect(page.getByRole("heading", { name: route === "login" ? "登录工作空间" : "初始化 Orbis", exact: true })).toBeVisible();

      const geometry = await page.evaluate(() => {
        function box(selector: string) {
          const element = document.querySelector<HTMLElement>(selector)!;
          const rect = element.getBoundingClientRect();
          return { x: rect.x, right: rect.right, width: rect.width, height: rect.height, lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight) };
        }
        return {
          shell: box(".auth-shell"),
          intro: box(".auth-intro"),
          title: box(".auth-intro h1"),
          subtitle: box(".auth-intro h1 span"),
          card: box(".auth-card"),
          cardTitle: box(".auth-card-heading h2"),
          field: box(".auth-form input[type=email]"),
          submit: box(".auth-submit"),
          introVisible: getComputedStyle(document.querySelector(".auth-intro")!).display !== "none",
          pageWidth: document.documentElement.scrollWidth,
          pageHeight: document.documentElement.scrollHeight,
        };
      });

      expect(Math.abs(geometry.shell.x + geometry.shell.width / 2 - viewport.width / 2)).toBeLessThan(2);
      expect(geometry.card.width).toBeGreaterThanOrEqual(Math.min(400, viewport.width - 64));
      expect(geometry.field.width).toBeGreaterThan(250);
      expect(geometry.field.x).toBeGreaterThan(geometry.card.x);
      expect(geometry.field.right).toBeLessThan(geometry.card.right);
      expect(geometry.submit.right).toBeLessThan(geometry.card.right);
      expect(geometry.cardTitle.height).toBeLessThan(geometry.cardTitle.lineHeight * 1.5);
      expect(geometry.pageWidth).toBeLessThanOrEqual(viewport.width + 1);

      if (viewport.width >= 1024) {
        expect(geometry.introVisible).toBe(true);
        expect(geometry.intro.right).toBeLessThan(geometry.card.x);
        expect(geometry.subtitle.right).toBeLessThan(geometry.card.x);
        expect(geometry.title.height).toBeLessThan(geometry.title.lineHeight * 2.5);
      } else {
        expect(geometry.introVisible).toBe(false);
        expect(Math.abs(geometry.card.x + geometry.card.width / 2 - viewport.width / 2)).toBeLessThan(2);
        expect(geometry.pageHeight).toBeLessThanOrEqual(viewport.height + 1);
      }
    });
  }
}
