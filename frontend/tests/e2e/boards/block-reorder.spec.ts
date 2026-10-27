import { expect, test } from "@playwright/test";
import { createCollection, createDocument, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

for (const grouped of [false, true]) test(`same-parent movement of ${grouped ? "a parent group" : "a board block"} requires confirmation when the board is unsaved`, async ({ page, request }) => {
  const session = await ownerSession(request);
  const headers = sessionHeaders(session);
  const collection = await createCollection(request, session, "画板块移动验收");
  const board = await responseData(await request.post(workspacePath(session, "/boards"), { headers, data: {
    id: crypto.randomUUID(), operation_id: crypto.randomUUID(), collection_id: collection.id, parent_id: null,
    title: "未保存画板", page_id: crypto.randomUUID(), elements: [],
  } }));
  const doc = await createDocument(request, session, collection.id, "上下移动画板");
  const block = { id: crypto.randomUUID(), type: "board", props: { board_id: board.id, page_id: board.pages[0].id, mode: "live", revision: null, frame_id: null }, content: [], children: [] };
  const root = grouped ? { id: crypto.randomUUID(), type: "group", props: {}, content: [], children: [block] } : block;
  const path = workspacePath(session, `/documents/${doc.id}/content`);
  await responseData(await request.put(path, { headers, data: {
    operation_id: crypto.randomUUID(), expected_version: 1, title: "上下移动画板", blocks: [root,
      { id: crypto.randomUUID(), type: "paragraph", props: {}, content: [{ text: "后面的段落", marks: [] }], children: [] },
    ],
  } }));
  await page.route(`**/boards/${board.id}/commands`, route => route.abort("connectionreset"));
  await openWithSession(page, session, `/documents/${doc.id}`);
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  await page.getByRole("button", { name: "审批流程", exact: true }).click();
  await expect(page.locator(".board-save-state")).toHaveText("保存失败");
  async function moveDown() {
    await page.locator(`[data-orbis-block-id="${block.id}"]`).first().hover({ position: { x: 3, y: 3 } });
    await page.getByRole("button", { name: "块操作：画板", exact: true }).click();
    if (grouped) await page.getByRole("menuitem", { name: /^选择父块：/ }).click();
    await page.getByRole("menuitem", { name: "下移", exact: true }).click();
    await expect(page.getByRole("alertdialog", { name: "画板尚未保存", exact: true })).toBeVisible();
  }
  await moveDown();
  await page.getByRole("button", { name: "保留画板块", exact: true }).click();
  await expect(page.locator(".board-save-state")).toHaveText("保存失败");
  expect((await responseData(await request.get(path, { headers }))).blocks[0].id).toBe(root.id);
  await moveDown();
  await page.getByRole("button", { name: "放弃并继续", exact: true }).click();
  await expect.poll(async () => (await responseData(await request.get(path, { headers }))).blocks.at(-1).id).toBe(root.id);
  await expect(page.locator(".board-save-state")).toHaveCount(0);
});
