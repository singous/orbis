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
      await expect(page.getByLabel("邮箱", { exact: true })).toBeVisible();
      await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
      if (route === "setup") await expect(page.getByLabel("显示名称", { exact: true })).toBeVisible();

      const geometry = await page.evaluate(() => {
        function box(selector: string) {
          const element = document.querySelector<HTMLElement>(selector)!;
          const rect = element.getBoundingClientRect();
          return { x: rect.x, right: rect.right, width: rect.width, height: rect.height, lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight) };
        }
        return {
          card: box(".auth-card"),
          cardTitle: box(".auth-card-heading h1"),
          field: box(".auth-form input[type=email]"),
          submit: box(".auth-submit"),
          pageWidth: document.documentElement.scrollWidth,
          pageHeight: document.documentElement.scrollHeight,
        };
      });

      expect(Math.abs(geometry.card.x + geometry.card.width / 2 - viewport.width / 2)).toBeLessThan(2);
      expect(geometry.card.width).toBeGreaterThanOrEqual(Math.min(400, viewport.width - 64));
      expect(geometry.field.width).toBeGreaterThan(250);
      expect(geometry.field.x).toBeGreaterThan(geometry.card.x);
      expect(geometry.field.right).toBeLessThan(geometry.card.right);
      expect(geometry.field.height).toBeGreaterThanOrEqual(40);
      expect(geometry.submit.height).toBeGreaterThanOrEqual(40);
      expect(geometry.submit.right).toBeLessThan(geometry.card.right);
      expect(geometry.cardTitle.height).toBeLessThan(geometry.cardTitle.lineHeight * 1.5);
      expect(geometry.pageWidth).toBeLessThanOrEqual(viewport.width + 1);
      expect(geometry.pageHeight).toBeLessThanOrEqual(viewport.height + 1);
    });
  }
}
