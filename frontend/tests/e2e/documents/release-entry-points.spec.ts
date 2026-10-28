import { expect, test } from "@playwright/test";
import { createCollection, createDocument, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

test("new board and table embeds offer creation without existing-resource pickers", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const session = await ownerSession(request);
  const collection = await createCollection(request, session, "Release embeds " + Date.now());
  const doc = await createDocument(request, session, collection.id, "组件编辑");
  await openWithSession(page, session, `/documents/${doc.id}`);
  const insert = async (name: string) => {
    await page.getByRole("button", { name: "插入内容", exact: true }).click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  await insert("画板");
  const board = page.locator(".embed-board");
  const canvas = board.getByRole("application", { name: "画板编辑区域" });
  await expect(canvas).toBeVisible();
  await canvas.focus();
  await canvas.press("Space");
  await expect(canvas).toBeVisible();
  await board.getByRole("button", { name: "审批流程", exact: true }).click();
  await expect(board.locator(".board-save-state")).toHaveText("已保存");
  await expect(board.locator(".board-page-actions")).toContainText("12 个对象");
  await expect.poll(() => canvas.locator("canvas").first().evaluate((node: HTMLCanvasElement) => node.getContext("2d")!.getImageData(0, 0, node.width, node.height).data.some((v, i) => i % 4 === 3 && v > 0))).toBe(true);
  await insert("数据表");
  await expect(page.locator(".embed-table")).toBeVisible();
  await expect(page.locator(".embed-table").getByRole("button", { name: "添加记录", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /选择画板|更换引用|引用已有|选择已有|选择数据表/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /分享|评论与历史|画板评论|画板历史|查看画板历史|收藏/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "站点", exact: true })).toHaveCount(0);
  const content = async () => responseData(await request.get(workspacePath(session, `/documents/${doc.id}/content`), { headers: sessionHeaders(session) }));
  await expect.poll(async () => (await content()).blocks.filter((b: any) => b.type === "board" && b.props.board_id).length).toBe(1);
  await page.screenshot({ path: test.info().outputPath("release-embeds.png"), fullPage: true });
  await page.reload();
  await expect(canvas).toBeVisible();
  await expect(board.locator(".board-page-actions")).toContainText("12 个对象");
  await expect(page.locator(".embed-table")).toBeVisible();
  expect(errors).toEqual([]);
  await page.goto(`/collections/${collection.id}`);
  await expect(page.getByRole("button", { name: /收藏|分享|快捷访问/ })).toHaveCount(0);
  await page.getByRole("button", { name: "笔记本操作", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "创建文档站点" })).toHaveCount(0);
});

test("an uncertain embedded-board creation reuses the block identity after reload", async ({ page, request }) => {
  const session = await ownerSession(request);
  const collection = await createCollection(request, session, "Retry embed " + Date.now());
  const doc = await createDocument(request, session, collection.id);
  const intents: unknown[] = [];
  await page.route("**/boards", async route => {
    if (route.request().method() !== "POST") return route.continue();
    intents.push(route.request().postDataJSON());
    if (intents.length === 1) { await route.fetch(); return route.abort("connectionreset"); }
    return route.continue();
  });
  await openWithSession(page, session, `/documents/${doc.id}`);
  await page.getByRole("button", { name: "插入内容", exact: true }).click();
  await page.getByRole("option", { name: "画板", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试创建画板" })).toBeVisible();
  // The blank block must reach the server before reopening it.
  await expect(page.locator(".document-header-actions .document-save-state")).toContainText("已保存");
  await page.reload();
  await expect(page.getByRole("application", { name: "画板编辑区域" })).toBeVisible();
  expect(intents).toHaveLength(2);
  expect(intents[0]).toEqual(intents[1]);
});
