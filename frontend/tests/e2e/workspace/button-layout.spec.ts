import {sessionFromPage,workspacePath} from "../helpers/api-fixtures";
import { expect, test, type Locator } from "@playwright/test";

const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
const notebookTitle = "图标与排版验证";

async function actionMetrics(action: Locator) {
  await expect(action).toBeVisible();
  return action.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const icon = element.querySelector("svg")?.getBoundingClientRect();
    return {
      height: bounds.height,
      width: bounds.width,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      padding: style.padding,
      gap: style.gap,
      iconWidth: icon?.width,
      iconHeight: icon?.height,
      overflow: element.scrollWidth - element.clientWidth,
    };
  });
}

function expectUsableAction(metrics: Awaited<ReturnType<typeof actionMetrics>>, name: string) {
  expect.soft(metrics.height, `${name}: usable native target height`).toBeGreaterThanOrEqual(24);
  expect.soft(metrics.width, `${name}: usable native target width`).toBeGreaterThanOrEqual(24);
  expect.soft(parseFloat(metrics.fontSize), `${name}: visible label typography`).toBeGreaterThanOrEqual(12);
  expect.soft(parseFloat(metrics.lineHeight), `${name}: text fits vertically`).toBeLessThanOrEqual(metrics.height);
  expect.soft(metrics.overflow, `${name}: label and icon fit horizontally`).toBeLessThanOrEqual(1);
}

test("workspace actions retain usable native sizing and notebook headings retain breathing room", async ({ page, request }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/setup");
  await page.getByLabel("显示名称", { exact: true }).fill("排版测试工作空间");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  const setupResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/setup") && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建并进入工作空间", exact: true }).click();
  const initialized = await setupResponse;
  if (initialized.status() === 409) {
    expect((await initialized.json()).code).toBe("SETUP_COMPLETED");
    await page.goto("/login");
    await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
    await page.getByLabel("密码", { exact: true }).fill(owner.password);
    await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  } else {
    expect(initialized.status()).toBe(201);
  }
  await expect(page).toHaveURL(/\/documents$/);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth.v2")!).accessToken as string);
  const session=await sessionFromPage(page);
    const created = await request.post(workspacePath(session,"/collections"), {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: notebookTitle, sort_order: 0, icon: { type: "preset", name: "rocket", color: "mint" } },
  });
  expect(created.status()).toBe(201);
  const notebookId = (await created.json()).data.id as string;
  const measurements: Record<string, unknown> = {};

  for (const width of [1034, 1440]) {
    await page.setViewportSize({ width, height: 897 });
    await page.goto(`/collections/${notebookId}`);
    await expect(page.getByRole("heading", { name: notebookTitle, exact: true })).toBeVisible();
    const main = page.getByRole("region", { name: "主工作区", exact: true });
    const sidebar = page.getByRole("region", { name: "笔记本目录栏", exact: true });
    const primary = await actionMetrics(main.getByRole("button", { name: "新建内容", exact: true }));
    const secondary = await actionMetrics(sidebar.locator(".workspace-sidebar-header").getByRole("button", { name: "创建内容", exact: true }));
    measurements[`create-${width}`] = { main: primary, sidebar: secondary };
    expectUsableAction(primary, `${width}px: primary action`);
    expectUsableAction(secondary, `${width}px: compact directory action`);
    await expect(main.getByRole("button", { name: "导出全部", exact: true })).toHaveCount(0);
    await expect(main.getByRole("button", { name: "导入 Markdown", exact: true })).toHaveCount(0);
    await main.getByRole("button", { name: "笔记本操作", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "导出全部", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "导入 Markdown", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    const heading = main.getByRole("heading", { name: notebookTitle, exact: true });
    const geometry = await heading.evaluate((element) => {
      const copy = element.parentElement!;
      const identity = copy.parentElement!;
      const header = element.closest("header")!;
      const icon = identity.querySelector(".notebook-icon")!;
      const actions = header.querySelector(".page-actions")!;
      const copyBox = copy.getBoundingClientRect();
      const titleBox = element.getBoundingClientRect();
      const statsBox = copy.querySelector(".notebook-home-stats")!.getBoundingClientRect();
      const iconBox = icon.getBoundingClientRect();
      const identityBox = identity.getBoundingClientRect();
      const actionBox = actions.getBoundingClientRect();
      const overlaps = identityBox.left < actionBox.right && identityBox.right > actionBox.left && identityBox.top < actionBox.bottom && identityBox.bottom > actionBox.top;
      return {
        topOffset: copyBox.top - iconBox.top,
        titleCenter: titleBox.top + titleBox.height / 2 - iconBox.top,
        iconHeight: iconBox.height,
        statsGap: statsBox.top - titleBox.bottom,
        statsAlignment: statsBox.left - titleBox.left,
        gap: copyBox.left - iconBox.right,
        overlaps,
      };
    });
    measurements[`heading-${width}`] = geometry;
    expect.soft(Math.abs(geometry.topOffset), `${width}px: cover copy stays aligned with the icon`).toBeLessThanOrEqual(8);
    expect.soft(geometry.titleCenter, `${width}px: title stays beside the icon`).toBeGreaterThan(0);
    expect.soft(geometry.titleCenter, `${width}px: title stays within the icon's vertical span`).toBeLessThan(geometry.iconHeight);
    expect.soft(geometry.statsGap, `${width}px: metadata has space below the title`).toBeGreaterThanOrEqual(6);
    expect.soft(geometry.statsAlignment, `${width}px: metadata aligns with the title`).toBeCloseTo(0, 0);
    expect.soft(geometry.gap, `${width}px: icon-to-text spacing`).toBeGreaterThanOrEqual(16);
    expect.soft(geometry.overlaps, `${width}px: header actions do not overlap notebook identity`).toBe(false);
  }

  await page.getByRole("button", { name: "笔记本操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "编辑笔记本", exact: true }).click();
  const notebookDialog = page.getByRole("dialog", { name: "编辑笔记本", exact: true });
  const uploadAction = await actionMetrics(notebookDialog.getByRole("button", { name: "上传自定义图标", exact: true }));
  const saveAction = await actionMetrics(notebookDialog.getByRole("button", { name: "保存", exact: true }));
  measurements.notebookDialog = { upload: uploadAction, save: saveAction };
  for (const [name, metrics] of [["upload", uploadAction], ["save", saveAction]] as const) {
    expectUsableAction(metrics, `notebook dialog ${name}`);
  }
  expect.soft(saveAction.height, "default dialog actions share height").toBe(uploadAction.height);
  expect.soft(saveAction.fontSize, "default dialog actions share typography").toBe(uploadAction.fontSize);
  expect.soft(uploadAction.iconWidth, "upload action icon remains visible").toBeGreaterThanOrEqual(12);
  expect.soft(uploadAction.iconHeight, "upload action icon remains square").toBe(uploadAction.iconWidth);
  expect.soft(uploadAction.iconHeight, "upload action icon fits its target").toBeLessThanOrEqual(uploadAction.height);
  await notebookDialog.getByRole("button", { name: "取消", exact: true }).click();

  await page.goto("/home");
  const homeAction = await actionMetrics(page.getByRole("button", { name: "写篇文档", exact: true }));
  measurements.home = homeAction;
  expectUsableAction(homeAction, "home primary action");
  expect.soft(homeAction.height, "home uses the same default action height").toBe(saveAction.height);
  expect.soft(homeAction.fontSize, "home uses the same default action typography").toBe(saveAction.fontSize);

  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 897 });
    await page.goto("/documents/collections");
    const card = page.getByRole("article").filter({ has: page.getByRole("link", { name: new RegExp(notebookTitle) }) });
    const create = card.getByRole("button", { name: "新建文档", exact: true });
    const metrics = await actionMetrics(create);
    const geometry = await create.evaluate((element) => {
      const card = element.closest("article")!;
      const actions = card.querySelector(".workbench-collection-actions")!;
      const createBox = element.getBoundingClientRect();
      const actionBox = actions.getBoundingClientRect();
      return {
        overlaps: createBox.left < actionBox.right && createBox.right > actionBox.left && createBox.top < actionBox.bottom && createBox.bottom > actionBox.top,
        overflow: card.scrollWidth - card.clientWidth,
      };
    });
    measurements[`emptyNotebook-${width}`] = { ...geometry, action: metrics };
    expectUsableAction(metrics, `${width}px: empty notebook create`);
    expect.soft(metrics.height, `${width}px: empty notebook uses the default action height`).toBe(saveAction.height);
    expect.soft(metrics.fontSize, `${width}px: empty notebook uses the default action typography`).toBe(saveAction.fontSize);
    expect.soft(geometry.overlaps, `${width}px: create action does not overlap notebook card actions`).toBe(false);
    expect.soft(geometry.overflow, `${width}px: notebook card does not overflow horizontally`).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 1440, height: 897 });
  await page.goto("/sites");
  await page.getByRole("button", { name: "创建站点", exact: true }).click();
  const siteAction = await actionMetrics(page.getByRole("dialog", { name: "创建文档站点" }).getByRole("button", { name: "创建站点", exact: true }));
  measurements.siteDialog = siteAction;
  expectUsableAction(siteAction, "site dialog primary action");
  expect.soft(siteAction.height, "site dialog uses the same default action height").toBe(saveAction.height);
  expect.soft(siteAction.fontSize, "site dialog uses the same default action typography").toBe(saveAction.fontSize);
  await page.getByRole("button", { name: "取消", exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/collections/${notebookId}`);
  await expect(page.getByRole("heading", { name: notebookTitle, exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => {
    const content = document.querySelector(".workspace-content")!;
    return {
      document: document.documentElement.scrollWidth - window.innerWidth,
      content: content.scrollWidth - content.clientWidth,
    };
  });
  measurements.mobileOverflow = overflow;
  expect.soft(overflow.document, "mobile viewport does not scroll horizontally").toBeLessThanOrEqual(1);
  expect.soft(overflow.content, "mobile workspace content does not hide horizontal overflow").toBeLessThanOrEqual(1);
  await testInfo.attach("layout-measurements", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
});
