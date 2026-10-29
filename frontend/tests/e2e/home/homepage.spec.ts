import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createCollection, createDocument, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

test("home captures an idea, resumes writing and adapts to small screens", async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const session = await ownerSession(request);
  const notebooks = [];
  for (const title of ["读书札记", "生活碎片", "产品手记"]) {
    notebooks.push(await createCollection(request, session, title));
  }
  for (const [index, title] of ["周末出走计划", "把零散的想法串起来", "Orbis 首页的小灵感"].entries()) {
    await createDocument(request, session, notebooks[index].id, title);
  }
  await page.setViewportSize({ width: 1487, height: 1058 });
  await openWithSession(page, session, "/home");
  await expect(page.getByRole("heading", { name: "嗨，欢迎回来。" })).toBeVisible();
  const composer = page.getByRole("region", { name: "快速记录" });
  const editor = composer.getByRole("textbox", { name: "随手记正文" });
  await expect(composer.getByRole("button", { name: "记一下" })).toBeDisabled();
  await expect(page.locator(".home-welcome-art")).toHaveJSProperty("naturalWidth", 640);
  const idea = `首页灵感 ${randomUUID().slice(0, 8)}`;
  await editor.fill(idea);
  await page.reload();
  await expect(editor).toContainText(idea);
  const savedResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/quick-notes"));
  await composer.getByRole("button", { name: "记一下" }).click();
  const receipt = await savedResponse;
  expect(receipt.ok(), await receipt.text()).toBe(true);
  await expect(composer.getByText("已记下", { exact: true })).toBeVisible();
  await expect(editor).toHaveText("");
  await expect(page.getByRole("navigation", { name: "内容统计" }).getByRole("link", { name: "1 条随手记" })).toBeVisible();
  const result = await responseData(await request.get(workspacePath(session, "/quick-notes?page=1&page_size=20"), { headers: sessionHeaders(session) }));
  expect(JSON.stringify(result.items)).toContain(idea);
  await page.screenshot({ path: testInfo.outputPath("home-desktop.png"), fullPage: true, animations: "disabled" });

  await composer.locator("summary").click();
  await composer.getByRole("button", { name: "管理标签" }).click();
  await expect(page.getByRole("dialog", { name: "管理标签" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await composer.locator("summary").click();
  const fileChooser = page.waitForEvent("filechooser");
  await composer.getByRole("button", { name: "添加附件", exact: true }).click();
  expect(await fileChooser).toBeTruthy();

  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(composer.getByRole("button", { name: "记一下" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflow = await page.locator(".home-page").evaluate(element => ({
      width: innerWidth, content: element.scrollWidth, available: element.clientWidth,
      elements: [...element.querySelectorAll("*")].filter(child => child.getBoundingClientRect().right > element.getBoundingClientRect().right).map(child => ({ tag: child.tagName, class: child.className, right: child.getBoundingClientRect().right })),
    }));
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true, animations: "disabled" });
    expect(overflow.content, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.available);
  }
  await page.locator(".workspace-content").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath("home-mobile.png"), fullPage: true, animations: "disabled" });
  await composer.screenshot({ path: testInfo.outputPath("home-mobile-composer.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1487, height: 1058 });
  await page.locator(".workspace-content").evaluate(element => { element.scrollTop = 0; });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: testInfo.outputPath("home-dark.png"), fullPage: true, animations: "disabled" });
  await page.emulateMedia({ colorScheme: "light" });
  const search = page.getByRole("search");
  await search.getByRole("searchbox", { name: "搜索文档" }).fill("首页");
  await search.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "全局搜索", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "搜索任何内容" })).toHaveValue("@doc 首页");
  await page.getByRole("button", { name: "关闭搜索" }).click();
  await page.getByRole("button", { name: "写篇文档", exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
  await expect(page.getByRole("textbox", { name: "文档标题" })).toBeVisible();
  expect(errors).toEqual([]);
});
