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

test("login validation identifies the email in a floating toast without moving the form", async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await page.getByLabel("邮箱", { exact: true }).fill("dev@orbis.local");
    await page.getByLabel("密码", { exact: true }).fill("OrbisDev123!");
    const submit = page.getByRole("button", { name: "登录 Orbis", exact: true });
    const before = await submit.boundingBox();
    await submit.click();
    const toast = page.getByRole("alertdialog", { name: "登录失败" });
    await expect(toast).toContainText("邮箱格式不正确，请检查后重试。");
    await expect(page.locator(".auth-form")).not.toContainText("邮箱格式不正确");
    expect((await submit.boundingBox())?.y).toBe(before?.y);
    await expect.poll(async () => {
      const box = await toast.boundingBox();
      return Boolean(box && box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height);
    }).toBe(true);
  }
});
