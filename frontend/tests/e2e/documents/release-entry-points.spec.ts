import { expect, test } from "@playwright/test";
import { createCollection, createDocument, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

test("board creation entries stay hidden while table embeds remain available", async ({ page, request }) => {
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
  await page.getByRole("button", { name: "创建内容", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "文档", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "数据表", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "画板", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "插入内容", exact: true }).click();
  await expect(page.getByRole("option", { name: "段落", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "画板", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await insert("数据表");
  await expect(page.locator(".embed-table")).toBeVisible();
  await expect(page.locator(".embed-table").getByRole("button", { name: "添加记录", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /选择画板|更换引用|引用已有|选择已有|选择数据表/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /分享|评论与历史|画板评论|画板历史|查看画板历史|收藏/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "站点", exact: true })).toHaveCount(0);
  const content = async () => responseData(await request.get(workspacePath(session, `/documents/${doc.id}/content`), { headers: sessionHeaders(session) }));
  await expect.poll(async () => (await content()).blocks.some((b: any) => b.type === "data_table")).toBe(true);
  expect((await content()).blocks.some((b: any) => b.type === "board")).toBe(false);
  await page.screenshot({ path: test.info().outputPath("release-embeds.png"), fullPage: true });
  await page.reload();
  await expect(page.locator(".embed-table")).toBeVisible();
  expect(errors).toEqual([]);
  await page.goto(`/collections/${collection.id}`);
  await expect(page.getByRole("button", { name: /分享|收藏|快捷访问/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "设为常用笔记本", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "笔记本操作", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "创建文档站点" })).toHaveCount(0);
});

test("blank board blocks remain intact without creating boards after reload", async ({ page, request }) => {
  const session = await ownerSession(request);
  const collection = await createCollection(request, session, "Deferred embed " + Date.now());
  const doc = await createDocument(request, session, collection.id);
  const intents: unknown[] = [];
  await page.route("**/boards", async route => {
    if (route.request().method() !== "POST") return route.continue();
    intents.push(route.request().postDataJSON());
    return route.continue();
  });
  const blockID = crypto.randomUUID();
  await responseData(await request.put(workspacePath(session, `/documents/${doc.id}/content`), { headers: sessionHeaders(session), data: {
    operation_id: crypto.randomUUID(), expected_version: 1, title: doc.title, blocks: [
      { id: blockID, type: "board", props: { board_id: null, page_id: null, mode: "live", revision: null, frame_id: null }, content: [], children: [] },
    ],
  } }));
  await openWithSession(page, session, `/documents/${doc.id}`);
  await expect(page.getByText("画板创建将在后续版本开放。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试创建画板" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("画板创建将在后续版本开放。", { exact: true })).toBeVisible();
  expect(intents).toHaveLength(0);
  const content = await responseData(await request.get(workspacePath(session, `/documents/${doc.id}/content`), { headers: sessionHeaders(session) }));
  expect(content.blocks).toContainEqual(expect.objectContaining({ id: blockID, type: "board", props: expect.objectContaining({ board_id: null }) }));
});

for (const query of ["board", "drawing", "canvas", "画板"]) {
  test(`slash command /${query} does not offer a board`, async ({ page, request }) => {
    const session = await ownerSession(request);
    const collection = await createCollection(request, session, "Deferred slash " + Date.now());
    const doc = await createDocument(request, session, collection.id);
    await openWithSession(page, session, `/documents/${doc.id}`);
    await page.locator(".ProseMirror").fill(`/${query}`);
    await expect(page.getByRole("option", { name: "画板", exact: true })).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toContainText(`/${query}`);
  });
}
