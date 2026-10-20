import { expect, test } from "@playwright/test";

const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };

test("user menu stays in view and preserves account and logout actions", async ({ page }) => {
  await page.goto("/setup");
  await page.getByLabel("显示名称", { exact: true }).fill("菜单测试工作空间");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  const setupResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/setup") && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建并进入工作空间", exact: true }).click();
  if ((await setupResponse).status() === 409) {
    await page.goto("/login");
    await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
    await page.getByLabel("密码", { exact: true }).fill(owner.password);
    await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/documents$/);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/documents");
    const mobileMenu = page.getByRole("button", { name: "打开主导航", exact: true });
    if (width < 768) await mobileMenu.click();
    const trigger = page.getByRole("button", { name: "打开用户菜单" });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "打开用户菜单" });
    await expect(menu).toBeVisible();
    const bounds = await menu.evaluate((element) => element.getBoundingClientRect().toJSON());
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(900);
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
    await expect(trigger).toBeFocused();
    if (width < 768) await expect(mobileMenu).toHaveAttribute("aria-expanded", "true");
  }

  await page.getByRole("button", { name: "打开用户菜单" }).click();
  await page.getByRole("menuitem", { name: "账号" }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await page.getByRole("button", { name: "打开主导航", exact: true }).click();
  await page.getByRole("button", { name: "打开用户菜单" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
