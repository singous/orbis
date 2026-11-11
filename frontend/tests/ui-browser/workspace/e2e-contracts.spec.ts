import { expect, test } from "@playwright/test";
import { expectNoContinuingMotion } from "../fixtures/media";
import { expectUnpaintedBoxShadow, sampleSidebarToggle } from "../../e2e/helpers/workspace-rendering";
import { installHomeFixture, notebooks } from "../fixtures/home";

test.beforeEach(async ({ page }) => {
  await installHomeFixture(page);
  await page.route("**/api/v1/workspaces/*/collections/*", async route => {
    const notebook = notebooks.find(item => new URL(route.request().url()).pathname.endsWith(`/collections/${item.id}`));
    if (!notebook) return route.fallback();
    await route.fulfill({ json: { code: "OK", message: "", request_id: "workspace-e2e-contracts", data: notebook } });
  });
});

for (const surface of ["web", "desktop"] as const) test(`${surface} E2E account menu locators preserve navigation, focus and logout`, async ({ page }) => {
  if (surface === "desktop") await page.addInitScript(() => Object.assign(window, { __ORBIS_HOST__: { surface: "desktop" } }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/documents");
    const drawer = page.getByRole("button", { name: "打开主导航", exact: true });
    if (surface === "web" && width === 390) await drawer.click();
    const trigger = page.getByRole("button", { name: "打开用户菜单", exact: true });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "用户操作", exact: true });
    await expect(menu.getByRole("menuitem", { name: "账号", exact: true })).toHaveAttribute("href", "/settings/account");
    await expect(menu.getByRole("menuitem", { name: "工作空间成员", exact: true })).toHaveAttribute("href", "/settings/members");
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    if (surface === "web" && width === 390) await expect(drawer).toHaveAttribute("aria-expanded", "true");
    await trigger.click();
    await page.getByRole("menuitem", { name: "账号", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/account$/);
    await expect(page.getByRole("heading", { name: "个人资料", exact: true })).toBeVisible();
  }
  if (surface === "web") await page.getByRole("button", { name: "打开主导航", exact: true }).click();
  await page.getByRole("button", { name: "打开用户菜单", exact: true }).click();
  const logout = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/auth/logout"));
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await logout;
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth.v2")!))).toMatchObject({ revoked: true });
});

test("E2E frames keep unpainted shadows across home, documents and notebook navigation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of ["/home", "/documents", `/collections/${notebooks[0].id}`]) {
    await page.goto(path);
    await expect(page.locator(".workspace-main-navigation")).toBeVisible();
    const target = page.locator(path.startsWith("/collections/") ? "#notebook-directory" : ".workspace-main-area");
    await expectUnpaintedBoxShadow(target);
  }
});

test("the unpainted-shadow probe rejects a visible layer mixed with transparent layers", async ({ page }) => {
  await page.goto("/documents");
  const panel = page.locator(".workspace-main-area");
  await expectUnpaintedBoxShadow(panel);
  await panel.evaluate(element => { (element as HTMLElement).style.boxShadow = "0 0 0 0 transparent, 0 2px 4px 0 rgb(0 0 0 / 20%)"; });
  await expect(expectUnpaintedBoxShadow(panel)).rejects.toThrow("every shadow layer to be unpainted");
});

test("E2E sidebar motion samples the completed transition while retaining intermediate frames and reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const entry of [
    { path: "/documents", collapse: "收起侧栏", expand: "展开侧栏", width: 272 },
    { path: `/collections/${notebooks[0].id}`, collapse: "收起笔记本目录", expand: "展开笔记本目录", width: 332 },
  ]) {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(entry.path);
    await expect(page.getByRole("button", { name: entry.collapse, exact: true })).toBeVisible();
    // 让实际高度过渡越过旧的 540ms 采样窗口，校验终点跟随 transition.finished。
    await page.locator(".rail-expand-slot").evaluate(element => { (element as HTMLElement).style.transitionDelay = "240ms"; });
    const collapse = await sampleSidebarToggle(page, entry.collapse);
    expect(collapse.intermediateFrames).toBeGreaterThan(2);
    expect(collapse.railTravel).toBeLessThanOrEqual(1);
    expect(collapse.startWidth).toBeCloseTo(entry.width, 0);
    expect(collapse.endWidth).toBeCloseTo(collapse.railWidth + 40, 0);
    expect(collapse.transitions).toEqual(expect.arrayContaining(["grid-template-columns:420", "height:420"]));
    await expect(page.getByRole("button", { name: entry.expand, exact: true })).toBeFocused();
    const expanded = await sampleSidebarToggle(page, entry.expand);
    expect(expanded.railTravel).toBeLessThanOrEqual(1);
    expect(expanded.endWidth).toBeCloseTo(collapse.startWidth, 0);
    await expect(page.getByRole("button", { name: entry.collapse, exact: true })).toBeFocused();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await sampleSidebarToggle(page, entry.collapse);
    expect(reduced.intermediateFrames).toBe(0);
    expect(reduced.railTravel).toBeLessThanOrEqual(1);
    expect(reduced.transitions).not.toContain("grid-template-columns:420");
    expect(reduced.transitions).not.toContain("height:420");
  }
});

test("E2E delayed notebook loading keeps visible skeletons and live navigation", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/workspaces/*/collections?**", async route => { await pending; await route.fallback(); });
  await page.goto("/documents");
  const placeholder = page.getByRole("status", { name: "正在加载笔记本…", exact: true });
  try {
    await expect(placeholder).toBeVisible();
    await expect(placeholder.locator('[data-slot="skeleton"]').first()).toBeVisible();
    await expect(page.getByRole("link", { name: "在线文档", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建资产", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "搜索", exact: true })).toBeVisible();
  } finally { release(); }
  await expect(placeholder).toHaveCount(0);
});

test("E2E cold startup checks the real skeleton reduced-motion contract and retains mounted navigation", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/src/app/WorkspaceRoute.tsx*", async route => { await pending; await route.continue(); });
  const opening = page.goto("/home");
  try {
    const startup = page.locator(".workspace-startup");
    await expect(startup).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expectNoContinuingMotion(startup);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { release(); }
  await opening;
  await expect(page.locator(".home-document-row")).toHaveCount(3);
  const navigation = page.locator(".workspace-main-navigation");
  const original = await navigation.elementHandle();
  await page.getByRole("button", { name: "打开主导航", exact: true }).click();
  await page.getByRole("link", { name: "在线文档", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  expect(await navigation.evaluate((element, original) => element === original, original)).toBe(true);
});
