import { expect, test } from "@playwright/test";
import { createCollection, createDocument, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

test("legacy board embeds preserve their binding and pending edits without replacement options", async ({ page, request }) => {
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
  await expect(page.getByRole("button", { name: /选择画板|更换引用|插入画板/ })).toHaveCount(0);
  expect(await boardID()).toBe(original.id);
  await expect(page.getByRole("button", { name: "重试保存", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开画板", exact: true })).toHaveAttribute("href", `/documents/${original.document_id}?page=${original.pages[0].id}`);
  expect((await responseData(await request.get(workspacePath(session, `/boards/${original.id}/snapshot`), { headers }))).elements).toHaveLength(0);
});
