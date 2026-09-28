import { expect, test } from "@playwright/test";

test("slow loads keep the workspace usable and sidebar motion respects reduced motion", async ({ page, request }) => {
  const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
  const setup = await request.post("/api/setup", { data: { ...owner, display_name: "加载动效验收" } });
  expect([201, 409]).toContain(setup.status());
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
  const created = await request.post("/api/notebooks", { headers: { Authorization: `Bearer ${token}` }, data: { title: "加载反馈验收", sort_order: 0 } });
  expect(created.status()).toBe(201);
  const notebookId = (await created.json()).data.id as string;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/notebooks?**", async route => { await pending; await route.continue(); });
  await page.reload();
  const placeholder = page.getByRole("status", { name: "正在加载笔记本…", exact: true });
  try {
    await expect(placeholder).toBeVisible();
    await expect(placeholder.locator(".skeleton").first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "文档导航", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "全局搜索", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
    const grid = page.locator(".workspace-shell-grid");
    const transitions = await grid.evaluate(element => element.getAnimations().map(animation => ({ duration: animation.effect?.getTiming().duration, property: (animation as CSSTransition).transitionProperty })));
    expect(transitions.some(animation => animation.property === "grid-template-columns" && animation.duration === 240)).toBe(true);
    await expect(page.getByRole("navigation", { name: "文档导航", exact: true })).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "文档导航", exact: true })).toBeVisible();
    expect(await grid.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.00001);
    expect(await page.locator(".workspace-route-content").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  } finally { release(); }
  await expect(placeholder).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "文档导航", exact: true }).locator(`a[href="/collections/${notebookId}"]`)).toBeVisible();
});
