import { expect, test } from "@playwright/test";
import { createCollection, createDocument, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

test("retrying an embedded load keeps the referenced second board page", async ({ page, request }) => {
  const session = await ownerSession(request);
  const headers = sessionHeaders(session);
  const collection = await createCollection(request, session, "画板分页重试验收");
  const board = await responseData(await request.post(workspacePath(session, "/boards"), { headers, data: {
    id: crypto.randomUUID(), operation_id: crypto.randomUUID(), collection_id: collection.id, parent_id: null,
    title: "双页画板", page_id: crypto.randomUUID(), elements: [],
  } }));
  const secondPage = crypto.randomUUID();
  await responseData(await request.post(workspacePath(session, `/boards/${board.id}/commands`), { headers, data: {
    operation_id: crypto.randomUUID(), schema_version: 1, commands: [{ type: "pages.create", page: {
      id: secondPage, name: "第二页", background: "#ffffff", position: 1, version: 0,
    } }],
  } }));
  const doc = await createDocument(request, session, collection.id, "引用第二页");
  await responseData(await request.put(workspacePath(session, `/documents/${doc.id}/content`), { headers, data: {
    operation_id: crypto.randomUUID(), expected_version: 1, title: "引用第二页", blocks: [{
      id: crypto.randomUUID(), type: "board", props: { board_id: board.id, page_id: secondPage, mode: "live", revision: null, frame_id: null }, content: [], children: [],
    }],
  } }));
  await openWithSession(page, session, `/documents/${doc.id}`);
  await expect(page.getByRole("img", { name: "双页画板" })).toBeVisible();
  let failNext = true;
  await page.route(`**/boards/${board.id}`, async route => {
    if (failNext && route.request().method() === "GET") {
      failNext = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "TEMPORARY_ERROR", message: "读取暂时失败", request_id: "page-retry-test" }) });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "无法打开画板", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("tab", { name: "第二页", exact: true })).toBeVisible();
  await expect(page.locator(".board-save-state")).toHaveText("已保存");
  await expect(page.getByText("引用的画板页面已不存在，请重新选择引用页面。", { exact: true })).toHaveCount(0);
});
