import {sessionFromPage,workspacePath} from "../helpers/api-fixtures";
import { sampleSidebarToggle as sampleToggle } from "../helpers/workspace-rendering";
import { expect, test } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });

test("ordinary menus and notebook trees share local collapse motion, focus and reduced motion", async ({ page, request }) => {
  const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
  const setup = await request.post("/api/v1/setup", { data: { ...owner,workspace_name:"浏览器测试空间", display_name: "侧栏一致性验收" } });
  expect([201, 409]).toContain(setup.status());
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  const session=await sessionFromPage(page);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth.v2")!).accessToken as string);
  const created = await request.post(workspacePath(session,"/collections"), { headers: { Authorization: `Bearer ${token}` }, data: { title: "侧栏一致性", sort_order: 0 } });
  expect(created.status()).toBe(201);
  const notebookId = (await created.json()).data.id as string;

  for (const entry of [
    { path: "/documents", collapse: "收起侧栏", expand: "展开侧栏", key: "orbis.sidebarCollapsed", width: 252 },
    { path: `/collections/${notebookId}`, collapse: "收起笔记本目录", expand: "展开笔记本目录", key: "orbis.notebookDirectoryCollapsed", width: 312 },
  ]) {
    await page.goto(entry.path);
    await expect(page.getByRole("button", { name: entry.collapse, exact: true })).toBeVisible();
    const collapse = await sampleToggle(page, entry.collapse);
    expect(collapse.intermediateFrames).toBeGreaterThan(2);
    expect(collapse.transitions).toContain("grid-template-columns:420");
    expect(collapse.railTravel).toBeLessThanOrEqual(1);
    expect(collapse.startWidth).toBeCloseTo(entry.width, 0);
    expect(collapse.endWidth).toBeCloseTo(collapse.railWidth, 0);
    await expect(page.getByRole("button", { name: entry.expand, exact: true })).toBeFocused();
    await expect(page.locator(".workspace-main-navigation .workspace-sidebar")).toHaveAttribute("inert", "");
    expect(await page.evaluate(key => localStorage.getItem(key), entry.key)).toBeNull();
    const expansion = await sampleToggle(page, entry.expand);
    expect(expansion.intermediateFrames).toBeGreaterThan(2);
    expect(expansion.railTravel).toBeLessThanOrEqual(1);
    expect(expansion.endWidth).toBeCloseTo(collapse.startWidth, 0);
    await expect(page.getByRole("button", { name: entry.collapse, exact: true })).toBeFocused();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await sampleToggle(page, entry.collapse);
    expect(reduced.intermediateFrames).toBe(0);
    expect(reduced.railTravel).toBeLessThanOrEqual(1);
    expect(reduced.transitions).not.toContain("grid-template-columns:420");
    expect(reduced.transitions).not.toContain("height:420");
    await page.reload();
    await expect(page.getByRole("button", { name: entry.collapse, exact: true })).toBeVisible();
    await expect(page.locator(".workspace-main-navigation .workspace-sidebar")).not.toHaveAttribute("inert", "");
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
});

test("slow document overview loading keeps the rail, global search and pinned shortcut entry usable", async ({ page, request }) => {
  const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
  expect([201, 409]).toContain((await request.post("/api/v1/setup", { data: { ...owner,workspace_name:"浏览器测试空间", display_name: "加载反馈验收" } })).status());
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/workspaces/*/collections?**", async route => { await pending; await route.continue(); });
  await page.reload();
  const placeholder = page.getByRole("status", { name: "正在加载笔记本…", exact: true });
  try {
    await expect(placeholder).toBeVisible();
    await expect(placeholder.locator('[data-slot="skeleton"]').first()).toBeVisible();
    await expect(page.getByRole("link", { name: "在线文档", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "搜索文档", exact: true })).toBeVisible();
  } finally { release(); }
  await expect(placeholder).toHaveCount(0);
});

test("ordinary and notebook mobile drawers share navigation, account actions and focus restoration without changing desktop preferences", async ({ page, request }) => {
  const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
  expect([201, 409]).toContain((await request.post("/api/v1/setup", { data: { ...owner,workspace_name:"浏览器测试空间", display_name: "抽屉一致性验收" } })).status());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  const session=await sessionFromPage(page);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth.v2")!).accessToken as string);
  const created = await request.post(workspacePath(session,"/collections"), { headers: { Authorization: `Bearer ${token}` }, data: { title: "移动目录验收", sort_order: 0 } });
  expect(created.status()).toBe(201);
  const notebookId = (await created.json()).data.id as string;
  for (const entry of [
    { path: "/documents", collapse: "收起侧栏", key: "orbis.sidebarCollapsed", navigation: "文档导航" },
    { path: `/collections/${notebookId}`, collapse: "收起笔记本目录", key: "orbis.notebookDirectoryCollapsed", navigation: "笔记本目录" },
  ]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(entry.path);
    await page.getByRole("button", { name: entry.collapse, exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const trigger = page.getByRole("button", { name: "打开主导航", exact: true });
    const frame = page.locator(".workspace-main-navigation");
    await trigger.click();
    await expect(page.getByRole("navigation", { name: entry.navigation, exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "应用导航", exact: true })).toBeVisible();
    await expect(page.getByRole("separator")).toHaveCount(0);
    const account = frame.getByRole("button", { name: "打开用户菜单", exact: true });
    await account.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "用户操作", exact: true });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(account).toBeFocused();
    const shortcuts = frame.getByRole("link", { name: "在线文档", exact: true });
    await shortcuts.focus();
    await shortcuts.press("ArrowRight");
    await expect(page.getByRole("navigation", { name: "笔记本快捷访问", exact: true })).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(shortcuts).toBeFocused();
    await frame.evaluate(element => {
      const items = Array.from(element.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex="0"]')).filter(item => item.getClientRects().length && !item.closest("[hidden], [inert]") && getComputedStyle(item).visibility !== "hidden");
      items.at(-1)?.focus();
    });
    await page.keyboard.press("Tab");
    expect(await frame.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole("button", { name: "关闭主导航", exact: true }).click({ position: { x: 380, y: 100 } });
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(key => localStorage.getItem(key), entry.key)).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
});


test("tab changes, history and reload start expanded while saved widths remain intact", async ({ page, request }) => {
  const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
  expect([201, 409]).toContain((await request.post("/api/v1/setup", { data: { ...owner,workspace_name:"浏览器测试空间", display_name: "侧栏状态重置验收" } })).status());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  const session=await sessionFromPage(page);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth.v2")!).accessToken as string);
  const created = await request.post(workspacePath(session,"/collections"), { headers: { Authorization: `Bearer ${token}` }, data: { title: "切换状态验收", sort_order: 0 } });
  expect(created.status()).toBe(201);
  const notebookPath = `/collections/${(await created.json()).data.id}`;
  await page.evaluate(() => {
    localStorage.setItem("orbis.sidebarCollapsed", "1");
    localStorage.setItem("orbis.notebookDirectoryCollapsed", "1");
    localStorage.setItem("orbis.sidebarWidth", "300");
    localStorage.setItem("orbis.notebookDirectoryWidth", "320");
  });
  const rail = page.getByRole("complementary", { name: "应用导航", exact: true });
  const frame = page.locator(".workspace-main-navigation");
  async function expectOpen(label: string, width: number) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    await expect(page.locator(".workspace-shell")).not.toHaveClass(/sidebar-collapsed/);
    await expect(page.locator(".workspace-sidebar")).not.toHaveAttribute("inert", "");
    await expect.poll(() => frame.evaluate(element => element.getBoundingClientRect().width - element.querySelector(".workspace-business-rail")!.getBoundingClientRect().width)).toBeCloseTo(width, 0);
  }
  await page.goto("/documents");
  await expectOpen("收起侧栏", 300);
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await rail.getByRole("button", { name: "打开用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "账号", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expectOpen("收起侧栏", 300);
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await page.goto("/documents");
  await expectOpen("收起侧栏", 300);
  await page.goBack();
  await expectOpen("收起侧栏", 300);
  await page.goto(notebookPath);
  await expectOpen("收起笔记本目录", 320);
  await page.getByRole("button", { name: "收起笔记本目录", exact: true }).click();
  await page.goto("/documents");
  await expectOpen("收起侧栏", 300);
  await page.goBack();
  await expectOpen("收起笔记本目录", 320);
  await page.getByRole("button", { name: "收起笔记本目录", exact: true }).click();
  await page.reload();
  await expectOpen("收起笔记本目录", 320);
  expect(await page.evaluate(() => [localStorage.getItem("orbis.sidebarWidth"), localStorage.getItem("orbis.notebookDirectoryWidth")])).toEqual(["300", "320"]);
});
