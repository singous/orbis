import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { createCollection, createDocument, openWithSession, ownerSession, responseData, sessionHeaders, workspacePath, type TestSession } from "../helpers/api-fixtures";

const runtime = { enabled: false };
type NativeBlock = { id: string; type: string; props: Record<string, unknown>; content: Array<{ text: string; marks: string[]; href: string | null }>; children: NativeBlock[] };
const paragraph = (text: string): NativeBlock => ({ id: crypto.randomUUID(), type: "paragraph", props: {}, content: text ? [{ text, marks: [], href: null }] : [], children: [] });
const text = (block: NativeBlock) => block.content.map(run => run.text).join("");
async function content(request: APIRequestContext, session: TestSession, id: string) {
  return responseData<{ revision: { version: number; title: string }; blocks: NativeBlock[] }>(await request.get(workspacePath(session, `/documents/${id}/content`), { headers: sessionHeaders(session) }));
}
async function fixture(request: APIRequestContext, title: string, values: string[] = []) {
  const session = await ownerSession(request);
  const collection = await createCollection(request, session, `${title} ${Date.now()}`);
  const document = await createDocument(request, session, collection.id, title);
  const metadata = await responseData(await request.get(workspacePath(session, `/documents/${document.id}`), { headers: sessionHeaders(session) }));
  runtime.enabled = metadata.collaboration_available === true;
  test.skip(!runtime.enabled, "The collaborative engine is disabled in this test environment");
  const blocks = values.map(paragraph);
  if (blocks.length) await responseData(await request.post(workspacePath(session, `/documents/${document.id}/operations`), { headers: sessionHeaders(session), data: {
    operation_id: crypto.randomUUID(), expected_version: document.content_version,
    operations: [{ type: "insert_blocks", parent_id: null, position: 0, blocks }],
  } }));
  return { session, document, collection, blocks };
}
async function openPair(browser: Browser, session: TestSession, id: string) {
  const first = await browser.newContext(), second = await browser.newContext();
  const a = await first.newPage(), b = await second.newPage();
  await Promise.all([openWithSession(a, session, `/documents/${id}`), openWithSession(b, session, `/documents/${id}`)]);
  await Promise.all([expect(a.locator(".ProseMirror")).toBeVisible(), expect(b.locator(".ProseMirror")).toBeVisible()]);
  await Promise.all([expect(a.locator(".document-save-state")).toHaveText("已保存"), expect(b.locator(".document-save-state")).toHaveText("已保存")]);
  return { a, b, first, second, close: async () => { await Promise.all([first.close(), second.close()]); } };
}
async function append(page: Page, id: string, value: string) {
  const block = page.locator(`.ProseMirror [data-orbis-block-id="${id}"]`).first();
  await block.click(); await lineBoundary(page, "end"); await page.keyboard.type(value);
}
async function lineBoundary(page: Page, edge: "start" | "end") {
  const apple = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));
  await page.keyboard.press(apple ? edge === "start" ? "Meta+ArrowLeft" : "Meta+ArrowRight" : edge === "start" ? "Home" : "End");
}
async function pastePlainText(page: Page) {
  const apple = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));
  if (!apple) { await page.keyboard.press("ControlOrMeta+Shift+V"); return; }
  // Playwright's macEditingCommands maps Meta+KeyV, but omits Shift+Meta+KeyV.
  // Ask Chromium to perform the real native edit command; its trusted paste
  // event still reads the actual system clipboard and enters the editor path.
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: 12, key: "V", code: "KeyV", windowsVirtualKeyCode: 86, commands: ["pasteAndMatchStyle"] });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 0, key: "V", code: "KeyV", windowsVirtualKeyCode: 86 });
  } finally { await cdp.detach(); }
}
async function caret(page: Page) {
  // Native arrow keys update the DOM before the selectionchange observer has
  // updated editor state; Enter consumes the latter, so wait for both.
  return page.locator(".ProseMirror").evaluate(element => {
    const editor = (element as HTMLElement & { editor: { state: { selection: { $from: { parentOffset: number } } } } }).editor;
    return { dom: window.getSelection()?.anchorOffset, editor: editor.state.selection.$from.parentOffset };
  });
}
async function localOperations(page: Page, id: string): Promise<string[]> {
  return page.evaluate(documentId => new Promise<string[]>((resolve, reject) => {
    const open = indexedDB.open("orbis-collaboration");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("operations", "readonly"), read = tx.objectStore("operations").getAll();
      tx.oncomplete = () => { resolve(read.result.filter((entry: { scope: string }) => entry.scope.includes(documentId)).map((entry: { operation_id: string }) => entry.operation_id)); db.close(); };
      tx.onerror = () => { reject(tx.error); db.close(); };
    };
  }), id);
}

// Real WebSocket transport, persisted Yjs state, Go transactions and the actual
// editor are all exercised here; only disposable synthetic accounts are used.
test("named document versions fix content and restore into an editable collaboration session", async ({ page, request }, testInfo) => {
  const { session, document, blocks } = await fixture(request, "文档版本管理", ["Version baseline"]);
  await openWithSession(page, session, `/documents/${document.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.locator(".document-save-state")).toHaveText("已保存");
  await expect(page.getByText(/^版本 \d+$/)).toHaveCount(0);
  async function openVersions() {
    await page.getByRole("button", { name: "评论与历史", exact: true }).click();
    await page.getByRole("tab", { name: "历史版本", exact: true }).click();
    await expect(page.getByLabel("新评论", { exact: true })).toBeHidden();
  }
  async function saveNamed(name: string) {
    await page.getByRole("button", { name: "新建命名版本", exact: true }).click();
    await page.getByLabel("新版本名称", { exact: true }).fill(name);
    await page.getByRole("button", { name: "保存命名版本", exact: true }).click();
    await expect(page.getByRole("button", { name: `查看版本 ${name}`, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await openVersions();
  await saveNamed("评审稿");
  await page.getByRole("button", { name: "关闭评论与历史", exact: true }).click();
  await append(page, blocks[0].id, " revised");
  await expect.poll(async () => text((await content(request, session, document.id)).blocks[0])).toBe("Version baseline revised");
  await openVersions();
  await saveNamed("修订稿");
  const saved = await responseData<{ items: Array<{ id: string; name: string; source_revision: number }> }>(await request.get(workspacePath(session, `/documents/${document.id}/versions`), { headers: sessionHeaders(session) }));
  const review = saved.items.find(version => version.name === "评审稿")!;
  const revised = saved.items.find(version => version.name === "修订稿")!;
  const fixed = await responseData<{ content: { blocks: NativeBlock[] } }>(await request.get(workspacePath(session, `/documents/${document.id}/versions/${review.id}/content`), { headers: sessionHeaders(session) }));
  expect(text(fixed.content.blocks[0])).toBe("Version baseline");
  const compared = await responseData<{ items: Array<{ change: string; before_text: string; after_text: string }> }>(await request.get(workspacePath(session, `/documents/${document.id}/versions/${revised.id}/compare?from_id=${review.id}`), { headers: sessionHeaders(session) }));
  expect(compared.items).toHaveLength(1);
  expect(compared.items[0]).toMatchObject({ change: "modified", before_text: "Version baseline", after_text: "Version baseline revised" });
  await page.locator('.document-versions [data-slot="select-trigger"]').click();
  await page.getByRole("option", { name: /评审稿/ }).click();
  await expect(page.getByRole("heading", { name: "内容差异", exact: true })).toBeVisible();
  await expect(page.getByText("Version baseline", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect((await page.getByRole("button", { name: "新建命名版本", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("button", { name: "恢复此版本", exact: true })).toBeVisible();
  expect(await page.locator(".collaboration-panel").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole("heading", { name: "修订稿", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("document-versions-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "查看版本 评审稿", exact: true }).click();
  await page.getByRole("button", { name: "恢复此版本", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "请求成功", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭评论与历史", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toHaveText("Version baseline");
  await append(page, blocks[0].id, " after restore");
  await expect.poll(async () => text((await content(request, session, document.id)).blocks[0])).toBe("Version baseline after restore");
  await expect(page.locator(".document-save-state")).toHaveText("已保存");
});

test("same-paragraph offline text and formatting converge in two real editors", async ({ browser, request }) => {
  const { session, document, blocks } = await fixture(request, "同段协作", ["Shared base"]);
  const pair = await openPair(browser, session, document.id);
  const errors: string[] = []; pair.a.on("pageerror", error => errors.push(error.message)); pair.b.on("pageerror", error => errors.push(error.message));
  try {
    await Promise.all([pair.first.setOffline(true), pair.second.setOffline(true)]);
    await append(pair.a, blocks[0].id, " A-tail");
    await pair.b.locator(`.ProseMirror [data-orbis-block-id="${blocks[0].id}"]`).click();
    await lineBoundary(pair.b, "start"); await pair.b.keyboard.press("ControlOrMeta+B"); await pair.b.keyboard.type("B-bold "); await pair.b.keyboard.press("ControlOrMeta+B");
    await expect(pair.b.locator(".ProseMirror strong")).toHaveText("B-bold ");
    await Promise.all([pair.first.setOffline(false), pair.second.setOffline(false)]);
    await expect.poll(async () => text((await content(request, session, document.id)).blocks[0]), { timeout: 30000 }).toBe("B-bold Shared base A-tail");
    await expect(pair.a.locator(".ProseMirror")).toHaveText("B-bold Shared base A-tail");
    await expect(pair.b.locator(".ProseMirror")).toHaveText("B-bold Shared base A-tail");
    const saved = await content(request, session, document.id);
    expect(saved.blocks[0].content.filter(run => run.marks.includes("bold")).map(run => run.text).join("")).toContain("B-bold");
    await expect(pair.a.locator(".ProseMirror strong")).toContainText("B-bold");
    expect(errors).toEqual([]);
  } finally { await pair.close(); }
});

test("different paragraphs merge with native API updates and offline reload recovery", async ({ browser, request }) => {
  const { session, document, blocks } = await fixture(request, "跨块协作", ["Alpha", "Beta", "Gamma"]);
  const pair = await openPair(browser, session, document.id);
  try {
    await Promise.all([append(pair.a, blocks[0].id, " A"), append(pair.b, blocks[1].id, " B")]);
    await expect.poll(async () => (await content(request, session, document.id)).blocks.map(text)).toEqual(["Alpha A", "Beta B", "Gamma"]);
    await pair.first.setOffline(true);
    await append(pair.a, blocks[0].id, " offline");
    await expect(pair.a.locator(".document-save-state")).toContainText("离线", { timeout: 30000 });
    await expect.poll(async () => (await localOperations(pair.a, document.id)).length).toBeGreaterThan(0);
    const before = await content(request, session, document.id);
    await responseData(await request.post(workspacePath(session, `/documents/${document.id}/operations`), { headers: sessionHeaders(session), data: {
      operation_id: crypto.randomUUID(), expected_version: before.revision.version,
      operations: [{ type: "update_block", block_id: blocks[2].id, block: { type: "paragraph", props: {}, content: [{ text: "Gamma from native API", marks: [], href: null }] } }],
    } }));
    await pair.first.setOffline(false);
    await expect.poll(async () => (await content(request, session, document.id)).blocks.map(text), { timeout: 30000 }).toEqual(["Alpha A offline", "Beta B", "Gamma from native API"]);
    await pair.a.reload();
    await expect(pair.a.locator(".ProseMirror")).toContainText("Alpha A offline");
    await expect(pair.a.locator(".ProseMirror")).toContainText("Gamma from native API");
    await expect(pair.b.locator(".ProseMirror")).toContainText("Alpha A offline");
  } finally { await pair.close(); }
});

test("two first-open editors create one paragraph in a blank document", async ({ browser, request }) => {
  const { session, document } = await fixture(request, "空白文档协作");
  const pair = await openPair(browser, session, document.id);
  try {
    expect((await content(request, session, document.id)).blocks).toHaveLength(0);
    await pair.a.locator(".ProseMirror").click(); await pair.a.keyboard.type("First paragraph");
    await expect(pair.b.locator(".ProseMirror")).toContainText("First paragraph");
    await pair.b.locator(".ProseMirror").click(); await lineBoundary(pair.b, "end"); await pair.b.keyboard.type(" from peer");
    await expect.poll(async () => (await content(request, session, document.id)).blocks.map(text)).toEqual(["First paragraph from peer"]);
    await expect(pair.a.locator(".ProseMirror p")).toHaveCount(1);
    await expect(pair.b.locator(".ProseMirror p")).toHaveCount(1);
  } finally { await pair.close(); }
});

test("a 5,500-block Markdown paste renders, saves completely and undoes once", async ({ page, request }) => {
  const { session, document } = await fixture(request, "长 Markdown 协作保存");
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openWithSession(page, session, `/documents/${document.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const markdown = '# Long document\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n- First\n- Second\n\n```go\nfmt.Println("hello")\n```\n\n' + Array.from({ length: 5495 }, (_, index) => `Paragraph ${index} with **marked text**.`).join("\n\n");
  await page.evaluate(value => navigator.clipboard.writeText(value), markdown);
  await page.locator(".ProseMirror").click(); await page.keyboard.press("ControlOrMeta+V");
  await expect(page.locator(".ProseMirror h1")).toHaveText("Long document");
  await expect(page.locator(".ProseMirror table")).toHaveCount(1);
  await expect(page.locator(".ProseMirror pre code")).toContainText('fmt.Println("hello")');
  await expect.poll(async () => { const value = await content(request, session, document.id); return { count: value.blocks.length, tail: value.blocks.length ? text(value.blocks.at(-1)!) : "" }; }, { timeout: 120000 }).toEqual({ count: 5500, tail: "Paragraph 5494 with marked text." });
  await expect(page.locator(".document-save-state")).toHaveText("已保存");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await content(request, session, document.id)).blocks.length, { timeout: 60000 }).toBe(0);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect.poll(async () => (await content(request, session, document.id)).blocks.length, { timeout: 120000 }).toBe(5500);
  const restored = await content(request, session, document.id), tail = restored.blocks.at(-1)!;
  await append(page, tail.id, " continued after redo");
  await expect.poll(async () => {
    const next = await content(request, session, document.id);
    return { newer: next.revision.version > restored.revision.version, tail: text(next.blocks.at(-1)!) };
  }, { timeout: 60000 }).toEqual({ newer: true, tail: "Paragraph 5494 with marked text. continued after redo" });
  expect(errors).toEqual([]);
});

test("paste as plain text preserves inline Markdown markers through save and undo", async ({ page, request }) => {
  const { session, document } = await fixture(request, "纯文本粘贴协作");
  await openWithSession(page, session, `/documents/${document.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const source = "**Literal bold** with `literal code`";
  await page.evaluate(value => navigator.clipboard.writeText(value), source);
  const editor = page.locator(".ProseMirror");
  await editor.evaluate(element => element.addEventListener("paste", event => element.setAttribute("data-native-paste-trusted", String(event.isTrusted)), { once: true }));
  await editor.click(); await pastePlainText(page);
  await expect(editor).toHaveAttribute("data-native-paste-trusted", "true");
  await expect(page.locator(".ProseMirror")).toHaveText(source);
  await expect(page.locator(".ProseMirror strong, .ProseMirror code")).toHaveCount(0);
  await expect.poll(async () => (await content(request, session, document.id)).blocks.map(text)).toEqual([source]);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await content(request, session, document.id)).blocks.length).toBe(0);
});

test("a committed update retries its original operation ID after a dropped WebSocket ACK", async ({ page, request }) => {
  const { session, document, blocks } = await fixture(request, "协作回执恢复", ["Before"]);
  const operationIds: string[] = [];
  let dropped = false;
  await page.routeWebSocket("**/collaboration/socket", client => {
    const server = client.connectToServer();
    client.onMessage(message => {
      const value = JSON.parse(String(message));
      if (value.type === "update") operationIds.push(value.operation_id);
      server.send(message);
    });
    server.onMessage(message => {
      const value = JSON.parse(String(message));
      if (value.type === "ack" && !dropped) { dropped = true; client.close(); server.close(); return; }
      client.send(message);
    });
  });
  await openWithSession(page, session, `/documents/${document.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const before = await content(request, session, document.id);
  await append(page, blocks[0].id, " durable");
  await expect.poll(() => operationIds.length, { timeout: 30000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".document-save-state")).toHaveText("已保存");
  expect(new Set(operationIds).size).toBe(1);
  const after = await content(request, session, document.id);
  expect(after.revision.version).toBe(before.revision.version + 1);
  expect(text(after.blocks[0])).toBe("Before durable");
});

test("explicit history restore opens the new epoch and remains editable", async ({ page, request }) => {
  const { session, document, blocks } = await fixture(request, "恢复历史协作", ["Historical body"]);
  const source = await content(request, session, document.id);
  await openWithSession(page, session, `/documents/${document.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await append(page, blocks[0].id, " current");
  await expect.poll(async () => text((await content(request, session, document.id)).blocks[0])).toBe("Historical body current");
  await page.getByRole("button", { name: "评论与历史", exact: true }).click();
  await page.getByRole("tab", { name: "历史版本", exact: true }).click();
  await page.getByRole("button", { name: "查看全部保存记录", exact: true }).click();
  await page.getByRole("button", { name: `查看保存记录 ${source.revision.version}`, exact: true }).click();
  await page.getByRole("button", { name: "恢复此版本", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "请求成功", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭评论与历史", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toHaveText("Historical body");
  await append(page, blocks[0].id, " after restore");
  await expect.poll(async () => text((await content(request, session, document.id)).blocks[0])).toBe("Historical body after restore");
  await expect(page.locator(".document-save-state")).toHaveText("已保存");
});

test("an external restore preserves offline edits for explicit recovery across reload", async ({ browser, request }) => {
  const { session, document, blocks } = await fixture(request, "历史切换草稿保护", ["Original"]);
  const source = await content(request, session, document.id);
  const pair = await openPair(browser, session, document.id);
  pair.b.on("dialog", dialog => { void dialog.accept(); });
  try {
    await append(pair.a, blocks[0].id, " committed");
    await expect.poll(async () => text((await content(request, session, document.id)).blocks[0])).toBe("Original committed");
    await pair.second.setOffline(true);
    await append(pair.b, blocks[0].id, " offline-preserved");
    await expect.poll(async () => (await localOperations(pair.b, document.id)).length).toBeGreaterThan(0);
    const latest = await content(request, session, document.id);
    await responseData(await request.post(workspacePath(session, `/documents/${document.id}/restore`), { headers: sessionHeaders(session), data: { operation_id: crypto.randomUUID(), expected_version: latest.revision.version, source_version: source.revision.version } }));
    await pair.second.setOffline(false);
    await expect(pair.b.getByRole("button", { name: "本机修改", exact: true })).toBeVisible({ timeout: 30000 });
    await pair.b.getByRole("button", { name: "本机修改", exact: true }).click();
    await expect(pair.b.locator(".ProseMirror")).toContainText("offline-preserved");
    const download = pair.b.waitForEvent("download");
    await pair.b.getByRole("button", { name: "下载本机草稿", exact: true }).click();
    const recovery = await download;
    const stream = await recovery.createReadStream();
    const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(chunks).toString());
    expect(exported.pending.length + exported.previous_epochs.reduce((count: number, entry: { pending: unknown[] }) => count + entry.pending.length, 0)).toBeGreaterThan(0);
    await pair.b.reload();
    await expect(pair.b.getByRole("button", { name: "本机修改", exact: true })).toBeVisible();
    await expect(pair.b.locator(".ProseMirror")).toHaveText("Original");
    expect(text((await content(request, session, document.id)).blocks[0])).toBe("Original");
  } finally { await pair.close(); }
});

test("an offline outbox survives a full page reload and resumes with its original operation IDs", async ({ page, request }) => {
  const { session, document, blocks } = await fixture(request, "离线草稿重载", ["Offline base", "Other block"]);
  page.on("dialog", dialog => { void dialog.accept(); });
  let online = true;
  const sockets: Array<{ close: () => void }> = [];
  const sent: string[] = [];
  await page.routeWebSocket("**/collaboration/socket", client => {
    sockets.push(client);
    if (!online) { client.close(); return; }
    const server = client.connectToServer();
    client.onMessage(message => { const wire = JSON.parse(String(message)); if (wire.type === "update") sent.push(wire.operation_id); server.send(message); });
    server.onMessage(message => client.send(message));
  });
  await openWithSession(page, session, `/documents/${document.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  online = false; sockets.forEach(socket => socket.close());
  await append(page, blocks[0].id, " retained");
  await expect.poll(async () => (await localOperations(page, document.id)).length).toBeGreaterThan(0);
  const original = await localOperations(page, document.id);
  await page.reload();
  await expect(page.locator(".ProseMirror")).toContainText("Offline base retained");
  const before = await content(request, session, document.id);
  expect(text(before.blocks[0])).toBe("Offline base");
  await responseData(await request.post(workspacePath(session, `/documents/${document.id}/operations`), { headers: sessionHeaders(session), data: {
    operation_id: crypto.randomUUID(), expected_version: before.revision.version,
    operations: [{ type: "update_block", block_id: blocks[1].id, block: { type: "paragraph", props: {}, content: [{ text: "Native while offline", marks: [], href: null }] } }],
  } }));
  online = true;
  await expect.poll(async () => (await content(request, session, document.id)).blocks.map(text), { timeout: 30000 }).toEqual(["Offline base retained", "Native while offline"]);
  await expect(page.locator(".document-save-state")).toHaveText("已保存");
  expect(new Set(sent)).toEqual(new Set(original));
});

test("a rejected target edit stays exportable after opening a fresh server lane", async ({ page, request }) => {
  const { session, document, blocks } = await fixture(request, "并发目标恢复入口", ["Target original", "Other block"]);
  let online = true;
  const sockets: Array<{ close: () => void }> = [];
  await page.routeWebSocket("**/collaboration/socket", client => {
    sockets.push(client);
    if (!online) { client.close(); return; }
    const server = client.connectToServer();
    client.onMessage(message => server.send(message)); server.onMessage(message => client.send(message));
  });
  await openWithSession(page, session, `/documents/${document.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  online = false; sockets.forEach(socket => socket.close());
  await append(page, blocks[0].id, " retained");
  await expect.poll(async () => (await localOperations(page, document.id)).length).toBeGreaterThan(0);
  const before = await content(request, session, document.id);
  await responseData(await request.post(workspacePath(session, `/documents/${document.id}/operations`), { headers: sessionHeaders(session), data: {
    operation_id: crypto.randomUUID(), expected_version: before.revision.version,
    operations: [{ type: "delete_block", block_id: blocks[0].id, delete_subtree: true }],
  } }));
  online = true;
  await expect(page.locator(".document-save-state")).toHaveText("本机草稿需要恢复", { timeout: 30000 });
  await page.getByRole("button", { name: "本机修改", exact: true }).click();
  await expect(page.getByRole("button", { name: "保留本机草稿并载入服务端", exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".ProseMirror")).toContainText("Target original retained");
  await page.getByRole("button", { name: "保留本机草稿并载入服务端", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toHaveText("Other block");
  const draftModal = page.getByRole("dialog", { name: "本机修改", exact: true });
  if (await draftModal.isVisible()) await draftModal.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "本机修改", exact: true }).click();
  const markdown = page.getByRole("button", { name: /下载草稿 Markdown/ }).first();
  await expect(markdown).toBeVisible();
  const download = page.waitForEvent("download"); await markdown.click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toContain("Target original retained");
  await page.getByRole("dialog", { name: "本机修改", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
  await append(page, blocks[1].id, " continued");
  await expect.poll(async () => (await content(request, session, document.id)).blocks.map(text)).toEqual(["Other block continued"]);
  await expect(page.locator(".document-save-state")).toHaveText("已保存");
  await page.reload();
  await expect(page.locator(".ProseMirror")).toHaveText("Other block continued");
  await page.getByRole("button", { name: "本机修改", exact: true }).click();
  await expect(page.getByRole("button", { name: /下载草稿 Markdown/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "保留本机草稿并载入服务端", exact: true })).not.toBeVisible();
});

test("paragraph split undo redo and continued typing retain stable saved blocks", async ({ page, request }) => {
  const { session, document, blocks } = await fixture(request, "分段撤销协作", ["SplitHere"]);
  await openWithSession(page, session, `/documents/${document.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.locator(`.ProseMirror [data-orbis-block-id="${blocks[0].id}"]`).click();
  await lineBoundary(page, "start");
  await expect.poll(() => caret(page)).toEqual({ dom: 0, editor: 0 });
  for (let index = 0; index < 5; index += 1) await page.keyboard.press("ArrowRight");
  await expect.poll(() => caret(page)).toEqual({ dom: 5, editor: 5 });
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await content(request, session, document.id)).blocks.map(text)).toEqual(["Split", "Here"]);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await content(request, session, document.id)).blocks.map(text)).toEqual(["SplitHere"]);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect.poll(async () => (await content(request, session, document.id)).blocks.map(text)).toEqual(["Split", "Here"]);
  const split = await content(request, session, document.id);
  expect(split.blocks[0].id).toBe(blocks[0].id);
  expect(split.blocks[1].id).not.toBe(blocks[0].id);
  await page.locator(`.ProseMirror [data-orbis-block-id="${split.blocks[1].id}"]`).click();
  await lineBoundary(page, "start"); await page.keyboard.type("Next ");
  await expect.poll(async () => (await content(request, session, document.id)).blocks.map(text)).toEqual(["Split", "Next Here"]);
  await expect(page.locator(".document-save-state")).toHaveText("已保存");
  await page.reload();
  await expect(page.locator(".ProseMirror p")).toHaveCount(2);
  await expect(page.locator(".ProseMirror p").nth(1)).toHaveText("Next Here");
});
