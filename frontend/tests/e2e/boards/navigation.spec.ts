import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createCollection, createDocument, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

async function fixture(request: APIRequestContext) {
  const session = await ownerSession(request);
  const headers = sessionHeaders(session);
  const collection = await createCollection(request, session, "画板内存保存验收");
  const board = await responseData(await request.post(workspacePath(session, "/boards"), { headers, data: {
    id: crypto.randomUUID(), operation_id: crypto.randomUUID(), collection_id: collection.id, parent_id: null,
    title: "临时保存状态", page_id: crypto.randomUUID(), elements: [],
  } }));
  const snapshot = () => request.get(workspacePath(session, `/boards/${board.id}/snapshot`), { headers }).then(responseData);
  return { session, headers, collection, board, snapshot };
}

async function rejectBoardStorage(page: Page) {
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, version) => {
      if (name === "orbis-board-drafts") throw new Error("Board draft storage must not be accessed");
      return original(name, version);
    };
  });
}

test("source-board navigation stays blocked while another embed has unsaved changes", async ({ page, request }) => {
  const { session, headers, collection, board, snapshot } = await fixture(request);
  const doc = await createDocument(request, session, collection.id, "同画板双引用");
  await responseData(await request.put(workspacePath(session, `/documents/${doc.id}/content`), { headers, data: {
    operation_id: crypto.randomUUID(), expected_version: 1, title: "同画板双引用", blocks: Array.from({ length: 2 }, () => ({
      id: crypto.randomUUID(), type: "board", props: { board_id: board.id, page_id: board.pages[0].id, mode: "live", revision: null, frame_id: null }, content: [], children: [],
    })),
  } }));
  await rejectBoardStorage(page);
  const operations: string[] = [];
  await page.route(`**/boards/${board.id}/commands`, async route => {
    operations.push(route.request().postData()!);
    if (operations.length === 1) await route.abort("connectionreset");
    else await route.continue();
  });
  await openWithSession(page, session, `/documents/${doc.id}`);
  const first = page.locator(".embed-board").nth(0);
  const second = page.locator(".embed-board").nth(1);
  await first.getByRole("button", { name: "编辑画板", exact: true }).click();
  await second.getByRole("button", { name: "编辑画板", exact: true }).click();
  await expect(first.locator(".board-save-state")).toHaveText("已保存");
  await expect(second.locator(".board-save-state")).toHaveText("已保存");
  await first.getByRole("button", { name: "审批流程", exact: true }).click();
  await expect(first.locator(".board-save-state")).toHaveText("保存失败");
  await first.getByRole("link", { name: "打开画板", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "画板尚未保存" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/documents/${doc.id}$`));
  await page.getByRole("button", { name: "留在当前页", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "画板尚未保存" })).toHaveCount(0);
  await expect(first.locator(".board-save-state")).toHaveText("保存失败");
  await second.getByRole("button", { name: "审批流程", exact: true }).click();
  await expect(second.locator(".board-save-state")).toHaveText("已保存");
  await expect.poll(async () => (await snapshot()).elements.length).toBe(12);
  await expect(first.locator(".board-save-state")).toHaveText("保存失败");
  await first.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(first.locator(".board-save-state")).toHaveText("已保存");
  await expect.poll(async () => (await snapshot()).elements.length).toBe(24);
  expect(operations).toHaveLength(3);
  expect(operations[2]).toBe(operations[0]);
  expect(JSON.parse(operations[1]).operation_id).not.toBe(JSON.parse(operations[0]).operation_id);
});


test("same-tab sidebar navigation requires an explicit discard before leaving a failed board save", async ({ page, request }) => {
  const { session, board, snapshot } = await fixture(request);
  await page.route(`**/boards/${board.id}/commands`, route => route.abort("connectionreset"));
  await openWithSession(page, session, `/documents/${board.document_id}`);
  await page.getByRole("button", { name: "审批流程", exact: true }).click();
  await expect(page.locator(".board-save-state")).toHaveText("保存失败");
  await page.getByRole("link", { name: "首页", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "画板尚未保存" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/documents/${board.document_id}$`));
  await page.getByRole("button", { name: "放弃并离开", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goBack();
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  await expect(page.locator(".board-page-actions")).toContainText("0 个对象");
  expect((await snapshot()).elements).toHaveLength(0);
});
