import { expect, test, type Locator } from "@playwright/test";

const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
const notebookTitle = "图标与排版验证";

async function actionMetrics(action: Locator, containingLabel = false) {
  await expect(action).toBeVisible();
  return action.evaluate((node, useLabel) => {
    const element = useLabel ? node.closest("label")! : node;
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
    };
  }, containingLabel);
}

test("workspace actions share sizing and notebook headings retain breathing room", async ({ page, request }, testInfo) => {
  await page.goto("/setup");
  await page.getByLabel("显示名称", { exact: true }).fill("排版测试工作空间");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  const setupResponse = page.waitForResponse((response) => response.url().endsWith("/api/setup") && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建并进入工作空间", exact: true }).click();
  const initialized = await setupResponse;
  if (initialized.status() === 409) {
    expect((await initialized.json()).code).toBe("SYSTEM_ALREADY_INITIALIZED");
    await page.goto("/login");
    await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
    await page.getByLabel("密码", { exact: true }).fill(owner.password);
    await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  } else {
    expect(initialized.status()).toBe(201);
  }
  await expect(page).toHaveURL(/\/documents$/);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
  const created = await request.post("/api/notebooks", {
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
    const sidebar = page.getByRole("region", { name: "侧栏", exact: true });
    const primary = await actionMetrics(main.getByRole("button", { name: "新建文档", exact: true }));
    const secondary = await actionMetrics(sidebar.getByRole("button", { name: "新建文档", exact: true }));
    measurements[`create-${width}`] = { main: primary, sidebar: secondary };
    expect.soft(secondary, `${width}px: both new-document actions use the same dimensions and typography`).toEqual(primary);
    for (const name of ["新建文档", "导出全部", "导入 Markdown"]) {
      const metrics = await actionMetrics(main.getByRole("button", { name, exact: true }));
      expect.soft(metrics.height, `${width}px: ${name} height`).toBe(36);
      expect.soft(metrics.fontSize, `${width}px: ${name} font`).toBe("14px");
    }

    const heading = main.getByRole("heading", { name: notebookTitle, exact: true });
    const geometry = await heading.evaluate((element) => {
      const copy = element.parentElement!;
      const identity = copy.parentElement!;
      const header = element.closest("header")!;
      const icon = identity.querySelector(".notebook-icon")!;
      const actions = header.querySelector(".page-actions")!;
      const copyBox = copy.getBoundingClientRect();
      const iconBox = icon.getBoundingClientRect();
      const identityBox = identity.getBoundingClientRect();
      const actionBox = actions.getBoundingClientRect();
      const overlaps = identityBox.left < actionBox.right && identityBox.right > actionBox.left && identityBox.top < actionBox.bottom && identityBox.bottom > actionBox.top;
      return {
        topInset: copyBox.top - iconBox.top,
        bottomInset: iconBox.bottom - copyBox.bottom,
        gap: copyBox.left - iconBox.right,
        overlaps,
      };
    });
    measurements[`heading-${width}`] = geometry;
    expect.soft(geometry.topInset, `${width}px: text starts inside the icon's upper edge`).toBeGreaterThanOrEqual(2);
    expect.soft(geometry.bottomInset, `${width}px: text ends inside the icon's lower edge`).toBeGreaterThanOrEqual(2);
    expect.soft(geometry.gap, `${width}px: icon-to-text spacing`).toBeGreaterThanOrEqual(16);
    expect.soft(geometry.overlaps, `${width}px: header actions do not overlap notebook identity`).toBe(false);
  }

  await page.getByRole("button", { name: "编辑笔记本", exact: true }).click();
  const notebookDialog = page.getByRole("dialog", { name: "编辑笔记本", exact: true });
  const uploadAction = await actionMetrics(notebookDialog.getByLabel("上传自定义图标", { exact: true }), true);
  const saveAction = await actionMetrics(notebookDialog.getByRole("button", { name: "保存", exact: true }));
  measurements.notebookDialog = { upload: uploadAction, save: saveAction };
  for (const [name, metrics] of [["upload", uploadAction], ["save", saveAction]] as const) {
    expect.soft(metrics.height, `notebook dialog ${name} action height`).toBe(36);
    expect.soft(metrics.fontSize, `notebook dialog ${name} action font`).toBe("14px");
    expect.soft(metrics.lineHeight, `notebook dialog ${name} action line height`).toBe("20px");
  }
  expect.soft(uploadAction.iconWidth, "upload action icon width").toBe(16);
  expect.soft(uploadAction.iconHeight, "upload action icon height").toBe(16);
  await notebookDialog.getByRole("button", { name: "取消", exact: true }).click();

  await page.goto("/home");
  const homeAction = await actionMetrics(page.getByRole("link", { name: "新建笔记本", exact: true }));
  measurements.home = homeAction;
  expect.soft(homeAction.height, "home primary action height").toBe(36);
  expect.soft(homeAction.fontSize, "home primary action font").toBe("14px");

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
    expect.soft(metrics.height, `${width}px: empty notebook create height`).toBe(36);
    expect.soft(metrics.fontSize, `${width}px: empty notebook create font`).toBe("14px");
    expect.soft(geometry.overlaps, `${width}px: create action does not overlap notebook card actions`).toBe(false);
    expect.soft(geometry.overflow, `${width}px: notebook card does not overflow horizontally`).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 1440, height: 897 });
  await page.goto("/sites");
  await page.getByRole("button", { name: "创建站点", exact: true }).click();
  const siteAction = await actionMetrics(page.getByRole("dialog", { name: "创建文档站点" }).getByRole("button", { name: "创建站点", exact: true }));
  measurements.siteDialog = siteAction;
  expect.soft(siteAction.height, "site dialog primary action height").toBe(36);
  expect.soft(siteAction.fontSize, "site dialog primary action font").toBe("14px");
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
