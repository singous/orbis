import { expect, test } from "@playwright/test";
import { createCollection, openWithSession, ownerSession } from "../helpers/api-fixtures";

test("common notebooks stay synchronized across the sidebar, overview and notebook actions", async ({ page, request }, testInfo) => {
  const session = await ownerSession(request);
  const title = `常用工作本 ${crypto.randomUUID().slice(0, 6)}`;
  const otherTitle = `普通生活本 ${crypto.randomUUID().slice(0, 6)}`;
  const notebook = await createCollection(request, session, title);
  await createCollection(request, session, otherTitle);
  await openWithSession(page, session, "/documents");
  const navigation = page.getByRole("navigation", { name: "文档导航", exact: true });
  const common = page.getByRole("region", { name: "常用", exact: true });
  const groups = page.locator(".notebook-overview-group");
  await expect(common.getByText(/将笔记本设为常用/)).toBeVisible();
  await expect(navigation.getByRole("link", { name: title, exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: otherTitle, exact: true })).toHaveCount(0);
  await expect(groups.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await expect(groups.getByRole("link", { name: new RegExp(otherTitle) })).toBeVisible();

  await page.getByRole("button", { name: `设为常用：${title}`, exact: true }).click();
  await expect(navigation.getByRole("link", { name: title, exact: true })).toBeVisible();
  await expect(common.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await expect(groups.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await expect(navigation.getByRole("link", { name: otherTitle, exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("common-notebooks-desktop.png"), animations: "disabled" });
  await page.reload();
  await expect(common.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await expect(navigation.getByRole("link", { name: title, exact: true })).toBeVisible();

  const otherTab = await page.context().newPage();
  await otherTab.goto("/documents");
  const otherNavigation = otherTab.getByRole("navigation", { name: "文档导航", exact: true });
  await expect(otherNavigation.getByRole("link", { name: title, exact: true })).toBeVisible();
  await common.getByRole("button", { name: `取消常用：${title}`, exact: true }).click();
  await expect(navigation.getByRole("link", { name: title, exact: true })).toHaveCount(0);
  await expect(otherNavigation.getByRole("link", { name: title, exact: true })).toHaveCount(0);
  await expect(otherTab.getByRole("region", { name: "常用", exact: true }).getByRole("link")).toHaveCount(0);
  await expect(groups.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await otherTab.close();

  await page.goto("/documents/collections");
  await page.getByRole("button", { name: `设为常用 ${title}`, exact: true }).click();
  await page.goto("/documents");
  await expect(common.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await page.goto(`/collections/${notebook.id}`);
  await page.getByRole("button", { name: "取消常用笔记本", exact: true }).click();
  await page.getByRole("button", { name: "笔记本快捷操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "设为常用", exact: true }).click();
  await page.goto("/documents");
  await expect(common.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await expect(navigation.getByRole("link", { name: title, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(common).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("common-notebooks-mobile.png"), animations: "disabled" });
});
