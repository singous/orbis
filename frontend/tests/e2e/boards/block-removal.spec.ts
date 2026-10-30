import { expect, test } from "@playwright/test";
import { createCollection, createDocument, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

for (const mode of ["menu", "range", "group"] as const) test(`pending board edits survive ${mode} removal or reparenting until explicit confirmation`, async ({ page, request }) => {
  const grouped = mode === "range";
  const session = await ownerSession(request);
  const headers = sessionHeaders(session);
  const collection = await createCollection(request, session, "移除画板块验收");
  const board = await responseData(await request.post(workspacePath(session, "/boards"), { headers, data: {
    id: crypto.randomUUID(), operation_id: crypto.randomUUID(), collection_id: collection.id, parent_id: null,
    title: "待保存画板", page_id: crypto.randomUUID(), elements: [],
  } }));
  const doc = await createDocument(request, session, collection.id, "移除未保存画板");
  const block = { id: crypto.randomUUID(), type: "board", props: { board_id: board.id, page_id: board.pages[0].id, mode: "live", revision: null, frame_id: null }, content: [], children: [] };
  const path = workspacePath(session, `/documents/${doc.id}/content`);
  await responseData(await request.put(path, { headers, data: {
    operation_id: crypto.randomUUID(), expected_version: 1, title: "移除未保存画板", blocks: [
      grouped ? { id: crypto.randomUUID(), type: "group", props: {}, content: [], children: [block] } : block,
      { id: crypto.randomUUID(), type: "paragraph", props: {}, content: [{ text: "保留的正文", marks: [] }], children: [] },
    ],
  } }));
  await page.route(`**/boards/${board.id}/commands`, route => route.abort("connectionreset"));
  await openWithSession(page, session, `/documents/${doc.id}`);
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  await page.getByRole("button", { name: "审批流程", exact: true }).click();
  await expect(page.locator(".board-save-state")).toHaveText("保存失败");
  const before = (await responseData(await request.get(path, { headers }))).blocks;
  async function remove() {
    if (grouped) {
      await page.locator('.ProseMirror').focus();
      await page.locator('.ProseMirror').press('ControlOrMeta+a');
      await page.locator('.ProseMirror').press('Backspace');
    } else {
      await page.locator(`[data-orbis-block-id="${block.id}"]`).first().hover({ position: { x: 3, y: 3 } });
      await page.getByRole('button', { name: '块操作：画板', exact: true }).click();
      await page.getByRole('menuitem', { name: mode === 'group' ? '组合' : '删除', exact: true }).click();
    }
    await expect(page.getByRole('alertdialog', { name: '画板尚未保存', exact: true })).toBeVisible();
  }
  await remove();
  expect((await responseData(await request.get(path, { headers }))).blocks).toEqual(before);
  await page.getByRole('button', { name: '保留画板块', exact: true }).click();
  await expect(page.locator('.board-save-state')).toHaveText('保存失败');
  await expect(page.getByRole('button', { name: '重试保存', exact: true })).toBeVisible();
  await remove();
  await page.getByRole('button', { name: '放弃并继续', exact: true }).click();
  if (mode === "group") {
    await expect(page.locator('.embed-board')).toHaveCount(1);
    await expect(page.locator('.board-save-state')).toHaveCount(0);
    await expect.poll(async () => (await responseData(await request.get(path, { headers }))).blocks[0].type).toBe("group");
  } else {
    await expect(page.locator('.embed-board')).toHaveCount(0);
    await expect.poll(async () => JSON.stringify((await responseData(await request.get(path, { headers }))).blocks).includes(board.id)).toBe(false);
  }
  expect((await responseData(await request.get(workspacePath(session, `/boards/${board.id}/snapshot`), { headers }))).elements).toHaveLength(0);
});
