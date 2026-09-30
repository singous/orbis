import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function signIn(page: Page, request: APIRequestContext, notebook: boolean) {
  const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
  const setup = await request.post("/api/setup", { data: { ...owner, display_name: "侧栏宽度验收" } });
  expect([201, 409]).toContain(setup.status());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  if (notebook) {
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
    const created = await request.post("/api/notebooks", { headers: { Authorization: `Bearer ${token}` }, data: { title: "目录宽度回归", sort_order: 0 } });
    expect(created.status()).toBe(201);
    await page.goto(`/collections/${(await created.json()).data.id}`);
  } else await page.goto("/knowledge");
}

const width = (page: Page) => page.locator(".workspace-main-navigation").evaluate((element) => element.getBoundingClientRect().width);

for (const notebook of [false, true]) {
  const resizeLabel = notebook ? "调整笔记本目录宽度" : "调整侧栏宽度";
  const collapseLabel = notebook ? "收起笔记本目录" : "收起侧栏";
  const expandLabel = notebook ? "展开笔记本目录" : "展开侧栏";
  const name = notebook ? "notebook" : "ordinary";

test(`${name}: the gap reveals a resize line and dragging preserves the width across reloads`, async ({ page, request }) => {
  await signIn(page, request, notebook);
  const handle = page.getByRole("separator", { name: resizeLabel, exact: true });
  const line = handle.locator(".workspace-resize-line");
  await expect(handle).toBeVisible();
  await expect(line).toHaveCSS("opacity", "0");
  const before = await width(page);
  const mainBefore = (await page.getByRole("region", { name: "主工作区", exact: true }).boundingBox())!.width;
  const bounds = (await handle.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await expect(line).toHaveCSS("opacity", "1");
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 8 });
  await expect.poll(() => width(page)).toBeCloseTo(before + 100, 0);
  await expect(handle).toHaveAttribute("data-resizing", "true");
  expect(await page.locator("body").evaluate((element) => getComputedStyle(element).userSelect)).toBe("none");
  await page.mouse.up();
  await page.mouse.move(800, y);
  await expect(line).toHaveCSS("opacity", "0");
  expect(await page.locator("body").evaluate((element) => getComputedStyle(element).userSelect)).not.toBe("none");
  expect((await page.getByRole("region", { name: "主工作区", exact: true }).boundingBox())!.width).toBeCloseTo(mainBefore - 100, 0);
  await page.reload();
  await expect.poll(() => width(page)).toBeCloseTo(before + 100, 0);
  await handle.focus();
  await handle.press("ArrowLeft");
  await expect(line).toHaveCSS("opacity", "1");
  await expect.poll(() => width(page)).toBeCloseTo(before + 84, 0);
  await page.getByRole("button", { name: collapseLabel, exact: true }).click();
  await expect(handle).toHaveCount(0);
  await page.getByRole("button", { name: expandLabel, exact: true }).click();
  await expect.poll(() => width(page)).toBeCloseTo(before + 84, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(handle).toHaveCount(0);
  await page.getByRole("button", { name: "打开主导航", exact: true }).click();
  await expect(page.getByRole("button", { name: "关闭侧栏", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});

test(`${name}: resize cancellation and bounds keep the main pane usable and preserve the preferred desktop width`, async ({ page, request }) => {
  await signIn(page, request, notebook);
  const handle = page.getByRole("separator", { name: resizeLabel, exact: true });
  await expect(handle).toBeVisible();
  const before = await width(page);
  const initialValue = Number(await handle.getAttribute("aria-valuenow"));
  const bounds = (await handle.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 5 });
  await expect.poll(() => width(page)).toBeCloseTo(before + 80, 0);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => width(page)).toBeCloseTo(before, 0);
  await handle.focus();
  await handle.press("Home");
  const minimum = Number(await handle.getAttribute("aria-valuemin"));
  await expect(handle).toHaveAttribute("aria-valuenow", String(minimum));
  await handle.press("End");
  const maximum = Number(await handle.getAttribute("aria-valuemax"));
  await expect(handle).toHaveAttribute("aria-valuenow", String(maximum));
  await expect.poll(() => width(page)).toBeCloseTo(before - initialValue + maximum, 0);
  const preferred = await width(page);
  await page.setViewportSize({ width: 800, height: 844 });
  await expect.poll(async () => (await page.getByRole("region", { name: "主工作区", exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(359);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(() => width(page)).toBeCloseTo(preferred, 0);
  await handle.dblclick();
  await expect.poll(() => width(page)).toBeCloseTo(before, 0);
  await page.reload();
  await expect.poll(() => width(page)).toBeCloseTo(before, 0);
});

}
