import { expect, test } from "@playwright/test";
import { createCollection, createDocument, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

test("replacing a live reference keeps failed edits until the user explicitly discards them", async ({ page, request }) => {
  const session = await ownerSession(request);
  const headers = sessionHeaders(session);
  const collection = await createCollection(request, session, "更换引用验收");
  const boards = [];
  for (const title of ["正在编辑的画板", "替换目标画板"]) {
    boards.push(await responseData(await request.post(workspacePath(session, "/boards"), { headers, data: {
      id: crypto.randomUUID(), operation_id: crypto.randomUUID(), collection_id: collection.id, parent_id: null,
      title, page_id: crypto.randomUUID(), elements: [],
    } })));
  }
  const [original, replacement] = boards;
  const doc = await createDocument(request, session, collection.id, "替换未保存画板");
  const path = workspacePath(session, `/documents/${doc.id}/content`);
  await responseData(await request.put(path, { headers, data: {
    operation_id: crypto.randomUUID(), expected_version: 1, title: "替换未保存画板", blocks: [{
      id: crypto.randomUUID(), type: "board", props: { board_id: original.id, page_id: original.pages[0].id, mode: "live", revision: null, frame_id: null }, content: [], children: [],
    }],
  } }));
  await page.route(`**/boards/${original.id}/commands`, route => route.abort("connectionreset"));
  await openWithSession(page, session, `/documents/${doc.id}`);
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  await page.getByRole("button", { name: "审批流程", exact: true }).click();
  await expect(page.locator(".board-save-state")).toHaveText("保存失败");
  const boardID = async () => (await responseData(await request.get(path, { headers }))).blocks[0].props.board_id;
  async function selectReplacement() {
    await page.getByRole("button", { name: "更换引用", exact: true }).click();
    await page.getByRole("button", { name: "替换目标画板", exact: true }).click();
    await page.getByRole("button", { name: "插入画板", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "画板尚未保存", exact: true })).toBeVisible();
  }
  await selectReplacement();
  expect(await boardID()).toBe(original.id);
  await page.getByRole("button", { name: "保留当前画板", exact: true }).click();
  await expect(page.locator(".board-save-state")).toHaveText("保存失败");
  await expect(page.getByRole("button", { name: "重试保存", exact: true })).toBeVisible();
  expect(await boardID()).toBe(original.id);
  await selectReplacement();
  await page.getByRole("button", { name: "放弃并更换", exact: true }).click();
  await expect.poll(boardID).toBe(replacement.id);
  await expect(page.getByRole("link", { name: "打开画板", exact: true })).toHaveAttribute("href", `/documents/${replacement.document_id}?page=${replacement.pages[0].id}`);
  await expect(page.getByRole("button", { name: "重试保存", exact: true })).toHaveCount(0);
  expect((await responseData(await request.get(workspacePath(session, `/boards/${original.id}/snapshot`), { headers }))).elements).toHaveLength(0);
});
