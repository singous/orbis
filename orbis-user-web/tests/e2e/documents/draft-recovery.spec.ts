import { expect, test } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });
const credentials = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
const paragraph = (id: string, text: string) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text }], children: [] });

async function setup(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, count = 1000, suppliedBlocks?: unknown[]) {
  expect([201, 409]).toContain((await request.post("/api/setup", { data: { ...credentials, display_name: "Draft recovery" } })).status());
  const login = (await (await request.post("/api/auth/login", { data: credentials })).json()).data;
  const headers = { Authorization: `Bearer ${login.access_token}`, "X-Workspace-ID": login.workspace.id as string };
  const book = (await (await request.post("/api/notebooks", { headers, data: { title: "草稿恢复验收" } })).json()).data;
  const note = (await (await request.post("/api/notes", { headers, data: { notebook_id: book.id, title: "不能丢失的草稿" } })).json()).data;
  const blocks = suppliedBlocks ?? Array.from({ length: count }, (_, index) => paragraph(`draft-${index}`, `原始段落 ${index}`));
  const created = await request.put(`/api/notes/${note.id}/content`, { headers, data: { expected_version: 1, blocks: { schema_version: 2, editor: "blocknote", blocks } } });
  expect(created.status()).toBe(200);
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  const beganOpening = Date.now();
  await page.goto(`/documents/${note.id}`);
  await expect(page.locator(".tiptap.ProseMirror[contenteditable=true]")).toBeVisible();
  return { note, headers, blocks, openingMs: Date.now() - beganOpening };
}

async function draftTexts(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("orbis-document-drafts", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      return await new Promise<string[]>((resolve, reject) => { const request = db.transaction("checkpoints", "readonly").objectStore("checkpoints").getAll(); request.onsuccess = () => resolve(request.result.map(record => JSON.stringify(record.current.blocks))); request.onerror = () => reject(request.error); });
    } finally { db.close(); }
  });
}

test("a persisted partial draft survives a reload and syncs without losing the unread tail", async ({ page, request }) => {
  const { note, headers, blocks } = await setup(page, request);
  const path = `**/api/notes/${note.id}/blocks`;
  await page.route(path, route => route.abort("failed"));
  const first = page.locator(".tiptap.ProseMirror > p").first();
  await first.click();
  await page.keyboard.press("Home");
  await page.keyboard.insertText("刷新仍应保留的修改。");
  await expect.poll(async () => (await draftTexts(page)).some(value => value.includes("刷新仍应保留的修改。"))).toBe(true);
  await page.reload();
  await expect(page.locator(".tiptap.ProseMirror")).toContainText("刷新仍应保留的修改。");
  await expect(page.getByText("自动保存失败", { exact: true })).toBeVisible();
  await page.unroute(path);
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/notes/${note.id}/content`, { headers })).json()).data.content_version).toBe(3);
  const result = (await (await request.get(`/api/notes/${note.id}/content`, { headers })).json()).data;
  expect(result.blocks.blocks).toHaveLength(1000);
  expect(result.blocks.blocks.slice(32)).toEqual(blocks.slice(32));
  await expect.poll(async () => (await draftTexts(page)).some(value => value.includes("刷新仍应保留的修改。"))).toBe(false);
  await page.reload();
  await expect(page.locator(".tiptap.ProseMirror")).toContainText("刷新仍应保留的修改。");
});

test("two offline browser tabs retain separate drafts for the same note", async ({ page, context, request }) => {
  const { note } = await setup(page, request, 64);
  const second = await context.newPage();
  const path = `**/api/notes/${note.id}/blocks`;
  await context.route(path, route => route.abort("failed"));
  await second.goto(`/documents/${note.id}`);
  await expect(second.locator(".tiptap.ProseMirror[contenteditable=true]")).toBeVisible();
  for (const [tab, marker] of [[page, "第一标签页保留。"], [second, "第二标签页保留。"]] as const) {
    await tab.locator(".tiptap.ProseMirror > p").first().click();
    await tab.keyboard.press("Home");
    await tab.keyboard.insertText(marker);
  }
  await expect.poll(async () => { const values = await draftTexts(page); return values.some(value => value.includes("第一标签页保留。")) && values.some(value => value.includes("第二标签页保留。")); }).toBe(true);
  await Promise.all([page.reload(), second.reload()]);
  await expect(page.locator(".tiptap.ProseMirror")).toContainText("第一标签页保留。");
  await expect(second.locator(".tiptap.ProseMirror")).toContainText("第二标签页保留。");
  await context.unroute(path);
  await second.close();
});


test("an initially shallow giant container loads children without saving and preserves its unread descendants on edit", async ({ page, request }) => {
  const children = Array.from({ length: 10000 }, (_, index) => paragraph(`nested-child-${index}`, `子内容 ${index}`));
  const parent = { ...paragraph("nested-parent", "父内容"), children };
  const { note, headers } = await setup(page, request, 1, [parent]);
  const editor = page.locator(".tiptap.ProseMirror");
  await expect(editor.getByText("子内容 0", { exact: true })).toHaveCount(0);
  const reading = page.waitForResponse(response => response.url().includes(`/notes/${note.id}/content/children`) && new URL(response.url()).searchParams.get("parent_id") === "nested-parent");
  await page.getByRole("button", { name: "载入子内容（10000）", exact: true }).click();
  expect((await reading).status()).toBe(200);
  await expect(editor.getByText("子内容 0", { exact: true })).toBeVisible();
  await expect(editor.getByText("子内容 32", { exact: true })).toHaveCount(0);
  const before = (await (await request.get(`/api/notes/${note.id}/content`, { headers })).json()).data;
  expect(before.content_version).toBe(2);
  await editor.locator('[data-orbis-block-id="nested-child-0"]').click();
  await page.keyboard.press("Home");
  const saved = page.waitForResponse(response => response.url().endsWith(`/notes/${note.id}/blocks`) && response.request().method() === "PATCH");
  await page.keyboard.insertText("局部子块修改。");
  expect((await saved).status()).toBe(200);
  const after = (await (await request.get(`/api/notes/${note.id}/content`, { headers })).json()).data;
  expect(after.blocks.blocks[0].children).toHaveLength(10000);
  expect(after.blocks.blocks[0].children.slice(1)).toEqual(children.slice(1));
  expect(after.blocks.blocks[0].children[0].content[0].text).toContain("局部子块修改。");
});

test("the real application opens and edits a fully loaded 10000-block note within the interaction budget", async ({ page, request }) => {
  const { note, headers, openingMs } = await setup(page, request, 10000);
  expect(openingMs).toBeLessThan(1500);
  const editor = page.locator(".tiptap.ProseMirror[contenteditable=true]");
  const completionLimits: number[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith(`/notes/${note.id}/content/children`) && !url.searchParams.has("parent_id")) completionLimits.push(Number(url.searchParams.get("limit")));
  });
  await editor.locator(':scope > p').first().click();
  const beganCompleting = Date.now();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(editor.locator(':scope > p')).toHaveCount(10000, { timeout: 60000 });
  const completionMs = Date.now() - beganCompleting;
  expect(completionLimits).toContain(256);
  expect(completionLimits.every(limit => limit === 32 || limit === 256)).toBe(true);
  // This small-payload fixture fits 256 items inside the server byte budget.
  // One ordinary 32-item request may already be in flight before explicit load.
  expect(completionLimits.length).toBeLessThanOrEqual(41);
  await page.evaluate(() => {
    const element = document.querySelector('.tiptap') as HTMLElement & { editor: { commands: { setTextSelection(position: number): void }; view: { focus(): void } } };
    element.editor.commands.setTextSelection(1); element.editor.view.focus();
    const samples: number[] = [];
    Object.assign(window, { appInputSamples: samples });
    element.addEventListener('keydown', () => { const began = performance.now(); requestAnimationFrame(() => samples.push(performance.now() - began)); }, true);
  });
  const saved = page.waitForResponse(response => response.url().endsWith(`/notes/${note.id}/blocks`) && response.request().method() === "PATCH");
  await page.keyboard.type("abcdefghijklmnopqrstuvwxyz0123456789", { delay: 40 });
  await expect.poll(async () => (await page.evaluate(() => (window as Window & { appInputSamples: number[] }).appInputSamples.length))).toBe(36);
  const timing = await page.evaluate(() => {
    const samples = (window as Window & { appInputSamples: number[] }).appInputSamples.toSorted((a, b) => a - b);
    return { p95: samples[Math.floor(samples.length * .95)], max: samples.at(-1) };
  });
  console.log(JSON.stringify({ actualAppNoteId: note.id, blocks: 10000, openingMs, completionMs, completionRequests: completionLimits.length, ...timing }));
  expect(timing.p95).toBeLessThan(50);
  await expect(editor.locator(':scope > p').first()).toContainText("abcdefghijklmnopqrstuvwxyz0123456789");
  const acknowledgement = await saved;
  expect(acknowledgement.status()).toBe(200);
  expect(acknowledgement.request().postDataJSON().upserts).toHaveLength(1);
  const current = (await (await request.get(`/api/notes/${note.id}/blocks/draft-0`, { headers })).json()).data;
  expect(current.block.content[0].text).toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  expect(current.content_version).toBe(3);
});
