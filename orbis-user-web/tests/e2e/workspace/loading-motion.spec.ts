import { expect, test, type Page } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });

async function sampleToggle(page: Page, label: string) {
  return page.evaluate(async name => {
    const grid = document.querySelector(".workspace-shell-grid")!;
    const navigation = document.querySelector(".workspace-main-navigation")!;
    const button = Array.from(navigation.querySelectorAll("button")).find(item => item.getAttribute("aria-label") === name)!;
    const rail = navigation.querySelector(".workspace-business-nav")!;
    const startRailTop = rail.getBoundingClientRect().top;
    const startWidth = navigation.getBoundingClientRect().width;
    const widths: number[] = [];
    const railTops: number[] = [];
    const transitions = new Set<string>();
    button.click();
    const start = performance.now();
    while (performance.now() - start < 540) {
      await new Promise(requestAnimationFrame);
      widths.push(navigation.getBoundingClientRect().width);
      railTops.push(rail.getBoundingClientRect().top);
      for (const animation of grid.getAnimations({ subtree: true })) {
        if ("transitionProperty" in animation) transitions.add(`${(animation as CSSTransition).transitionProperty}:${animation.effect?.getTiming().duration}`);
      }
    }
    const endWidth = navigation.getBoundingClientRect().width;
    const endRailTop = rail.getBoundingClientRect().top;
    const railLow = Math.min(startRailTop, endRailTop) + 1;
    const railHigh = Math.max(startRailTop, endRailTop) - 1;
    const low = Math.min(startWidth, endWidth) + 1;
    const high = Math.max(startWidth, endWidth) - 1;
    return { startWidth, endWidth, startRailTop, endRailTop, railIntermediateFrames: railTops.filter(top => top > railLow && top < railHigh).length, intermediateFrames: widths.filter(width => width > low && width < high).length, transitions: Array.from(transitions) };
  }, label);
}

test("ordinary menus and notebook trees share local collapse motion, focus and reduced motion", async ({ page, request }) => {
  const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
  const setup = await request.post("/api/setup", { data: { ...owner, display_name: "侧栏一致性验收" } });
  expect([201, 409]).toContain(setup.status());
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
  const created = await request.post("/api/notebooks", { headers: { Authorization: `Bearer ${token}` }, data: { title: "侧栏一致性", sort_order: 0 } });
  expect(created.status()).toBe(201);
  const notebookId = (await created.json()).data.id as string;

  let ordinaryWidth: number | undefined;
  for (const entry of [
    { path: "/knowledge", collapse: "收起侧栏", expand: "展开侧栏", key: "orbis.sidebarCollapsed" },
    { path: `/collections/${notebookId}`, collapse: "收起笔记本目录", expand: "展开笔记本目录", key: "orbis.notebookDirectoryCollapsed" },
  ]) {
    await page.goto(entry.path);
    await expect(page.getByRole("button", { name: entry.collapse, exact: true })).toBeVisible();
    const collapse = await sampleToggle(page, entry.collapse);
    expect(collapse.intermediateFrames).toBeGreaterThan(2);
    expect(collapse.transitions).toContain("grid-template-columns:420");
    expect(collapse.railIntermediateFrames).toBeGreaterThan(2);
    expect(collapse.endRailTop - collapse.startRailTop).toBeCloseTo(32, 0);
    expect(collapse.transitions).toContain("height:420");
    if (ordinaryWidth === undefined) ordinaryWidth = collapse.startWidth;
    else expect(collapse.startWidth).toBeCloseTo(ordinaryWidth, 0);
    expect(collapse.endWidth).toBeCloseTo(58, 0);
    await expect(page.getByRole("button", { name: entry.expand, exact: true })).toBeFocused();
    await expect(page.locator(".workspace-main-navigation .workspace-sidebar")).toHaveAttribute("inert", "");
    expect(await page.evaluate(key => localStorage.getItem(key), entry.key)).toBeNull();
    const expansion = await sampleToggle(page, entry.expand);
    expect(expansion.intermediateFrames).toBeGreaterThan(2);
    expect(expansion.railIntermediateFrames).toBeGreaterThan(2);
    expect(expansion.endRailTop - expansion.startRailTop).toBeCloseTo(-32, 0);
    expect(expansion.endWidth).toBeCloseTo(collapse.startWidth, 0);
    await expect(page.getByRole("button", { name: entry.collapse, exact: true })).toBeFocused();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await sampleToggle(page, entry.collapse);
    expect(reduced.intermediateFrames).toBe(0);
    expect(reduced.railIntermediateFrames).toBe(0);
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
  expect([201, 409]).toContain((await request.post("/api/setup", { data: { ...owner, display_name: "加载反馈验收" } })).status());
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/notebooks?**", async route => { await pending; await route.continue(); });
  await page.reload();
  const placeholder = page.getByRole("status", { name: "正在加载笔记本…", exact: true });
  try {
    await expect(placeholder).toBeVisible();
    await expect(placeholder.locator(".skeleton").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "在线文档", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建资产", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "全局搜索", exact: true })).toBeVisible();
  } finally { release(); }
  await expect(placeholder).toHaveCount(0);
});

test("ordinary and notebook mobile drawers share navigation, creation dialogs and focus restoration without changing desktop preferences", async ({ page, request }) => {
  const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
  expect([201, 409]).toContain((await request.post("/api/setup", { data: { ...owner, display_name: "抽屉一致性验收" } })).status());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
  const created = await request.post("/api/notebooks", { headers: { Authorization: `Bearer ${token}` }, data: { title: "移动目录验收", sort_order: 0 } });
  expect(created.status()).toBe(201);
  const notebookId = (await created.json()).data.id as string;
  for (const entry of [
    { path: "/knowledge", collapse: "收起侧栏", key: "orbis.sidebarCollapsed", navigation: "知识库导航" },
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
    await expect(page.getByRole("button", { name: "新建资产", exact: true })).toHaveCount(1);
    await expect(page.getByRole("separator")).toHaveCount(0);
    const create = page.getByRole("button", { name: "新建资产", exact: true });
    await create.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "新建资产", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "新建资产", exact: true })).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(create).toBeFocused();
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
  expect([201, 409]).toContain((await request.post("/api/setup", { data: { ...owner, display_name: "侧栏状态重置验收" } })).status());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
  const created = await request.post("/api/notebooks", { headers: { Authorization: `Bearer ${token}` }, data: { title: "切换状态验收", sort_order: 0 } });
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
    await expect.poll(() => frame.evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(width, 0);
  }
  await page.goto("/knowledge");
  await expectOpen("收起侧栏", 358);
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await rail.getByRole("link", { name: "记忆", exact: true }).click();
  await expect(page).toHaveURL(/\/memory$/);
  await expectOpen("收起侧栏", 358);
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await rail.getByRole("link", { name: "知识库", exact: true }).click();
  await expectOpen("收起侧栏", 358);
  await page.goBack();
  await expectOpen("收起侧栏", 358);
  await page.goto(notebookPath);
  await expectOpen("收起笔记本目录", 378);
  await page.getByRole("button", { name: "收起笔记本目录", exact: true }).click();
  await rail.getByRole("link", { name: "知识库", exact: true }).click();
  await expectOpen("收起侧栏", 358);
  await page.goBack();
  await expectOpen("收起笔记本目录", 378);
  await page.getByRole("button", { name: "收起笔记本目录", exact: true }).click();
  await page.reload();
  await expectOpen("收起笔记本目录", 378);
  expect(await page.evaluate(() => [localStorage.getItem("orbis.sidebarWidth"), localStorage.getItem("orbis.notebookDirectoryWidth")])).toEqual(["300", "320"]);
});
