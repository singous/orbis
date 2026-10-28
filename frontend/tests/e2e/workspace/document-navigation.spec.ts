import { expect, test, type Page } from "@playwright/test";
import { createCollection, createDocument, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath } from "../helpers/api-fixtures";

type MotionTrace = { icons: number; content: number };
async function nextPaint(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }

test("document navigation retains chrome and does not replay area-icon or page-entry animations", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const session = await ownerSession(request), headers = sessionHeaders(session);
  const collection = await createCollection(request, session, "Navigation continuity " + Date.now());
  const parent = await createDocument(request, session, collection.id, "Motion parent");
  const sibling = await createDocument(request, session, collection.id, "Motion sibling");
  const child = await createDocument(request, session, collection.id, "Motion child", parent.id);
  for (const doc of [parent, sibling, child]) await responseData(await request.put(workspacePath(session, `/documents/${doc.id}/content`), { headers, data: {
    operation_id: crypto.randomUUID(), expected_version: 1, title: doc.title,
    blocks: [{ id: crypto.randomUUID(), type: "paragraph", props: {}, content: [{ text: doc.title + " content", marks: [] }], children: [] }],
  } }));
  const board = await responseData(await request.post(workspacePath(session, "/boards"), { headers, data: {
    id: crypto.randomUUID(), operation_id: crypto.randomUUID(), page_id: crypto.randomUUID(), collection_id: collection.id, parent_id: null, title: "Motion board", elements: [],
  } }));
  const sheet = await responseData(await request.post(workspacePath(session, "/sheets"), { headers, data: {
    id: crypto.randomUUID(), collection_id: collection.id, parent_id: null, title: "Motion table", template: "",
  } }));
  await openWithSession(page, session, `/documents/${parent.id}`);
  await expect(page.locator(".ProseMirror")).toHaveText(parent.title + " content");
  const expand = page.getByRole("button", { name: "展开子目录 Motion parent", exact: true });
  if (await expand.isVisible()) await expand.click();
  const shell = await page.locator(".workspace-shell").elementHandle();
  const rail = await page.locator(".workspace-business-rail").elementHandle();
  const content = await page.locator("#workspace-main-content").elementHandle();
  await nextPaint(page);
  await page.evaluate(() => {
    const trace: MotionTrace = { icons: 0, content: 0 };
    (window as Window & { navigationMotionTrace?: MotionTrace }).navigationMotionTrace = trace;
    document.addEventListener("animationstart", event => {
      if (event.animationName === "navigation-icon-select" && event.target instanceof Element && event.target.closest(".workspace-business-rail")) trace.icons++;
      if (event.animationName === "workspace-content-enter") trace.content++;
    });
  });
  const delayed = new Set([sibling.id, child.id, board.document_id, sheet.document_id]);
  await page.route("**/api/v1/workspaces/*/documents/*", async route => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (delayed.has(id)) await new Promise(resolve => setTimeout(resolve, 350));
    await route.continue();
  });
  async function navigate(title: string, ready: () => Promise<void>) {
    await page.locator(".document-context-link").getByText(title, { exact: true }).click();
    await ready();
    expect(await shell!.evaluate(node => node.isConnected && node === document.querySelector(".workspace-shell"))).toBe(true);
    expect(await rail!.evaluate(node => node.isConnected && node === document.querySelector(".workspace-business-rail"))).toBe(true);
    expect(await content!.evaluate(node => node.isConnected && node === document.getElementById("workspace-main-content"))).toBe(true);
  }
  for (const doc of [sibling, parent, child, parent]) await navigate(doc.title, () => expect(page.locator(".ProseMirror")).toHaveText(doc.title + " content"));
  await navigate("Motion board", () => expect(page.getByRole("application", { name: "画板编辑区域" })).toBeVisible());
  await navigate("Motion table", () => expect(page.getByRole("grid", { name: "数据表", exact: true })).toBeVisible());
  await navigate("Motion board", () => expect(page.getByRole("application", { name: "画板编辑区域" })).toBeVisible());
  await page.screenshot({ path: test.info().outputPath("stable-board-navigation.png") });
  await navigate(sibling.title, () => expect(page.locator(".ProseMirror")).toHaveText(sibling.title + " content"));
  await nextPaint(page);
  expect(await page.evaluate(() => (window as Window & { navigationMotionTrace?: MotionTrace }).navigationMotionTrace)).toEqual({ icons: 0, content: 0 });
  await page.locator(".workspace-business-rail").getByRole("link", { name: "首页", exact: true }).click();
  await expect(page.getByRole("heading", { name: "首页", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { navigationMotionTrace?: MotionTrace }).navigationMotionTrace!.icons)).toBe(1);
});

test("deferred forms expose no creation, publishing or saved-form entry in table documents", async ({ page, request }) => {
  const session = await ownerSession(request), headers = sessionHeaders(session);
  const collection = await createCollection(request, session, "Deferred forms " + Date.now());
  const sheet = await responseData(await request.post(workspacePath(session, "/sheets"), { headers, data: { id: crypto.randomUUID(), collection_id: collection.id, parent_id: null, title: "Deferred table", template: "" } }));
  const form = await responseData(await request.put(workspacePath(session, `/sheets/${sheet.id}/forms`), { headers, data: {
    id: crypto.randomUUID(), sheet_id: sheet.id, version: 0, enabled: true,
    config: { title: "Deferred collection form", description: "", fields: [{ field_id: sheet.definition.fields[0].id, required: false, description: "" }] },
  } }));
  const writes: string[] = [];
  page.on("request", req => { if (req.method() === "PUT" && req.url().endsWith("/forms")) writes.push(req.url()); });
  await openWithSession(page, session, `/documents/${sheet.document_id}?view=${form.id}`);
  await expect(page.getByRole("grid", { name: "数据表", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /生成表单|预览表单|开始收集|发布表单|分享表单/ })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: form.config.title, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "添加视图", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "表单", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "看板视图", exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  const saved = await responseData(await request.get(workspacePath(session, `/sheets/${sheet.id}/forms`), { headers }));
  expect(saved.items.find((item: any) => item.id === form.id)).toMatchObject({ enabled: true, token: form.token, version: form.version });
});
