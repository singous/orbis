import {sessionFromPage,createCollection,createDocument} from "../helpers/api-fixtures";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });
const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };

async function signIn(page: Page, request: APIRequestContext) {
  expect([201, 409]).toContain((await request.post("/api/v1/setup", { data: { ...owner,workspace_name:"浏览器测试空间", display_name: "外观验收" } })).status());
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
}
async function chooseAppearance(page: Page, label: string) {
  const drawer = page.getByRole("button", { name: "打开主导航", exact: true });
  if (page.viewportSize()!.width < 768 && await page.locator('.workspace-shell').getAttribute('data-app-surface') === 'web' && await drawer.getAttribute("aria-expanded") !== "true") await drawer.click();
  await page.getByRole("button", { name: "打开用户菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "外观", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "外观", exact: true });
  await expect(menu).toBeVisible();
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await menu.getByText(label, { exact: true }).click();
  await expect(menu.getByRole("radio", { name: label, exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("button", { name: "打开用户菜单", exact: true })).toBeFocused();
}

for (const surface of ["web", "desktop"] as const) for (const width of [1440, 390]) {
  test(`${surface} ${width}px: appearance switches, persists and follows the system while retaining the blue accent`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    if (surface === "desktop") await page.addInitScript(() => Object.assign(window, { __ORBIS_HOST__: { surface: "desktop" } }));
    await signIn(page, request);
    await chooseAppearance(page, "夜间");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("orbis.appearance"))).toBe("dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const create = page.locator(".notebook-overview .page-actions").getByRole("button", { name: "新建笔记本", exact: true });
    await expect(create).toBeVisible();
    await expect.poll(() => create.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("oklch(0.5774 0.2091 273.85)");
    await page.goto("/sites");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await chooseAppearance(page, "白天");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await chooseAppearance(page, "跟随系统");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "打开用户菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => page.getByLabel("邮箱", { exact: true }).evaluate(element => getComputedStyle(element).backgroundColor)).toBe("oklch(0.2103 0.0248 273.85)");
  });
}

test("the saved night preference is applied before the app JavaScript loads", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("orbis.appearance", "dark"));
  await page.route("**/assets/index-*.js", route => route.abort());
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.locator("#root").evaluate(element => element.childElementCount)).toBe(0);
  await expect.poll(() => page.locator("body").evaluate(element => getComputedStyle(element).backgroundColor)).toBe("oklch(0.12 0.0124 273.85)");
});

test("appearance switching keeps the current editor and its content mounted", async ({ page, request }) => {
  await signIn(page, request);
  const session=await sessionFromPage(page);
  const notebook=await createCollection(request,session,"外观草稿验收");
  const note=await createDocument(request,session,notebook.id,"切换外观的文档");
  await page.goto(`/documents/${note.id}`);
  const editor = page.locator(".tiptap.ProseMirror[contenteditable=true]");
  await expect(editor).toBeVisible();
  await editor.fill("切换外观时保留的编辑内容。");
  const original = await editor.elementHandle();
  await chooseAppearance(page, "夜间");
  await expect(page).toHaveURL(new RegExp(`/documents/${note.id}$`));
  await expect(editor).toContainText("切换外观时保留的编辑内容。");
  expect(await page.evaluate(element => element === document.querySelector(".tiptap.ProseMirror"), original)).toBe(true);
});

test("the appearance dialog supports keyboard selection and restores avatar focus", async ({ page, request }) => {
  await signIn(page, request);
  const trigger = page.getByRole("button", { name: "打开用户菜单", exact: true });
  await trigger.focus();
  await trigger.press("ArrowDown");
  const appearance = page.getByRole("menuitem", { name: "外观", exact: true });
  await appearance.focus();
  await appearance.press("Enter");
  const menu = page.getByRole("dialog", { name: "外观", exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole("radio", { name: "白天", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});
