import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });
const credentials = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };

async function longDocument(page: Page, request: APIRequestContext, count = 300) {
  expect([201, 409]).toContain((await request.post('/api/setup', { data: { ...credentials, display_name: 'Progressive content' } })).status());
  const auth = (await (await request.post('/api/auth/login', { data: credentials })).json()).data;
  const headers = { Authorization: `Bearer ${auth.access_token}`, 'X-Workspace-ID': auth.workspace.id as string };
  const notebook = (await (await request.post('/api/notebooks', { headers, data: { title: 'Long document ranges' } })).json()).data;
  const note = (await (await request.post('/api/notes', { headers, data: { notebook_id: notebook.id, title: 'Incremental long note' } })).json()).data;
  const blocks = Array.from({ length: count }, (_, index) => ({ id: `range-${index}`, type: 'paragraph', props: {}, content: [{ type: 'text', text: `Paragraph ${index}. ` + 'Readable content with a bounded first response. '.repeat(5) }], children: [] }));
  const saved = await request.put(`/api/notes/${note.id}/content`, { headers, data: { expected_version: 1, blocks: { schema_version: 2, editor: 'blocknote', blocks } } });
  expect(saved.status()).toBe(200);
  const original = (await saved.json()).data.blocks.blocks;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill(credentials.email);
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '登录 Orbis', exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  return { id: note.id as string, headers, original };
}

test('a delayed tail does not block first-screen editing and partial saves retain the complete document', async ({ page, request }) => {
  const note = await longDocument(page, request);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let tailRequests = 0, fullRequests = 0;
  await page.route(`**/api/notes/${note.id}/content**`, async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET') {
      if (url.pathname.endsWith('/content') && !url.searchParams.has('limit')) { fullRequests++; await route.abort(); return; }
      if (Number(url.searchParams.get('offset')) > 0) { tailRequests++; await held; }
    }
    await route.continue();
  });
  try {
    await page.goto(`/documents/${note.id}`);
    const editor = page.locator('.tiptap.ProseMirror[contenteditable=true]');
    await expect(editor).toBeVisible();
    const paragraphs = editor.locator(':scope > p');
    await expect(paragraphs).toHaveCount(32);
    expect(fullRequests).toBe(0);
    await page.locator('.document-scroll-region').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => tailRequests).toBeGreaterThan(0);
    await paragraphs.first().click();
    const saved = page.waitForResponse(response => response.url().includes(`/notes/${note.id}/blocks`) && response.request().method() === 'PATCH');
    await page.keyboard.type('Editing works before the tail arrives. ');
    const ack = await saved;
    expect(ack.status()).toBe(200);
    const payload = ack.request().postDataJSON();
    expect(payload.upserts).toHaveLength(1);
    expect(payload.upserts[0].children).toBeUndefined();
    expect(payload.moves).toHaveLength(0);
    expect(payload.deletes).toHaveLength(0);
    expect(payload.blocks).toBeUndefined();
    const complete = (await (await request.get(`/api/notes/${note.id}/content`, { headers: note.headers })).json()).data;
    expect(complete.blocks.blocks).toHaveLength(300);
    expect(complete.blocks.blocks.slice(32)).toEqual(note.original.slice(32));
    release();
    await expect(paragraphs).toHaveCount(64);
    await expect(paragraphs.first()).toContainText('Editing works before the tail arrives.');
    await page.getByRole('toolbar', { name: '文档格式', exact: true }).getByRole('button', { name: '撤销', exact: true }).click();
    await expect(paragraphs.first()).not.toContainText('Editing works before the tail arrives.');
    await expect(paragraphs).toHaveCount(64);
    expect(fullRequests).toBe(0);
  } finally { release(); }
});

test('explicit whole-document selection loads its remaining ranges before selecting', async ({ page, request }) => {
  const note = await longDocument(page, request, 96);
  await page.goto(`/documents/${note.id}`);
  const editor = page.locator('.tiptap.ProseMirror[contenteditable=true]');
  await expect(editor).toBeVisible();
  await expect(editor.locator(':scope > p')).toHaveCount(32);
  await editor.locator(':scope > p').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(editor.locator(':scope > p')).toHaveCount(96);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().includes('Paragraph 95.'))).toBe(true);
  const complete = (await (await request.get(`/api/notes/${note.id}/content`, { headers: note.headers })).json()).data;
  expect(complete.content_version).toBe(2);
  expect(complete.blocks.blocks).toEqual(note.original);
});
