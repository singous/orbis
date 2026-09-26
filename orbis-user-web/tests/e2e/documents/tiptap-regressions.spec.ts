import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const api = `http://127.0.0.1:${process.env.ORBIS_E2E_API_PORT || '9311'}`;
const credentials = { email: 'owner@example.com', password: 'Orbis-browser-test-2026!' };

async function prepare(page: Page, request: APIRequestContext, title: string) {
  let response = await request.post(`${api}/setup`, { data: { ...credentials, display_name: 'PR 6 acceptance' } });
  if (response.status() === 409) response = await request.post(`${api}/auth/login`, { data: credentials });
  expect(response.ok()).toBe(true);
  const auth = (await response.json()).data;
  const headers = { Authorization: `Bearer ${auth.access_token}` };
  const notebook = (await (await request.post(`${api}/notebooks`, { headers, data: { title: 'Acceptance fixtures' } })).json()).data;
  const note = (await (await request.post(`${api}/notes`, { headers, data: { notebook_id: notebook.id, title } })).json()).data;
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill(credentials.email);
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '登录 Orbis' }).click();
  await expect(page).toHaveURL(/\/documents$/);
  return { headers, note, read: async () => (await (await request.get(`${api}/notes/${note.id}/content`, { headers })).json()).data };
}

test('an existing BlockNote code block survives opening and a language change', async ({ page, request }, info) => {
  const { headers, note, read } = await prepare(page, request, 'Native code compatibility');
  const source = 'const ready = true;';
  const saved = await request.put(`${api}/notes/${note.id}/content`, { headers, data: { expected_version: 1, blocks: {
    schema_version: 2, editor: 'blocknote', blocks: [{ id: 'old-code', type: 'codeBlock', props: { language: 'typescript' }, content: [{ type: 'text', text: source, styles: {} }], children: [] }],
  } } });
  expect(saved.ok()).toBe(true);
  await page.goto(`/documents/${note.id}`);
  const code = page.locator('.orbis-code code');
  await expect(code).toBeVisible();
  const displayed = await code.innerText();
  await page.getByRole('combobox', { name: '代码语言' }).selectOption('javascript');
  await expect.poll(async () => (await read()).content_version).toBeGreaterThan(2);
  const persisted = await read();
  const evidence = { displayed, persistedCode: persisted.blocks.blocks[0].content, version: persisted.content_version };
  await info.attach('legacy-code.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
  expect(displayed).toBe(source);
  expect(persisted.plain_text).toBe(source);
});

test('a table inserted through the toolbar autosaves and keeps its header', async ({ page, request }, info) => {
  const { note, read } = await prepare(page, request, 'New table persistence');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/documents/${note.id}`);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByRole('toolbar', { name: '文档格式' }).getByRole('button', { name: '表格', exact: true }).click();
  await expect(page.locator('.ProseMirror table')).toBeVisible();
  await expect(page.locator('.ProseMirror th')).toHaveCount(3);
  await expect.poll(async () => (await read()).content_version, { timeout: 4000 }).toBeGreaterThan(1);
  const persisted = await read();
  const evidence = { errors, version: persisted.content_version, blocks: persisted.blocks };
  await info.attach('new-table.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
  expect(errors).toEqual([]);
  expect(persisted.blocks.blocks.find((block: { type: string }) => block.type === "table").content.headerRows).toBe(1);
  await page.reload();
  await expect(page.locator(".ProseMirror th")).toHaveCount(3);
  const cell = page.locator('.ProseMirror td').first().locator('p');
  await cell.click();
  await page.keyboard.type('first');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  await expect.poll(async () => (await read()).plain_text).toContain('first\nsecond');
  await page.reload();
  await expect(page.locator('.ProseMirror td').first()).toContainText('first');
  await expect(page.locator('.ProseMirror td').first()).toContainText('second');
});

test('native clipboard paste preserves image references and documentation properties', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { headers, note } = await prepare(page, request, 'Clipboard source');
  const mediaUrl = 'https://example.com/diagram.png';
  const source = { schema_version: 2, editor: 'blocknote', blocks: [
    { id: 'text', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Copy this document' }], children: [] },
    { id: 'image', type: 'image', props: { url: mediaUrl, name: 'diagram.png', caption: 'Important diagram' }, content: [], children: [] },
    { id: 'card', type: 'card', props: { title: 'Read the guide', href: 'https://example.com/guide' }, content: [], children: [{ id: 'body', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Retain the body' }], children: [] }] },
  ] };
  expect((await request.put(`${api}/notes/${note.id}/content`, { headers, data: { expected_version: 1, blocks: source } })).ok()).toBe(true);
  const destination = (await (await request.post(`${api}/notes`, { headers, data: { notebook_id: note.notebook_id, title: 'Clipboard destination' } })).json()).data;
  await page.goto(`/documents/${note.id}`);
  await page.locator('.ProseMirror > p').first().click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+C');
  await page.goto(`/documents/${destination.id}`);
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+V');
  const read = async () => (await (await request.get(`${api}/notes/${destination.id}/content`, { headers })).json()).data;
  await expect.poll(async () => (await read()).plain_text).toContain('Retain the body');
  const stored = (await read()).blocks.blocks;
  expect(stored.find((block: { type: string }) => block.type === 'image').props).toMatchObject({ url: mediaUrl, name: 'diagram.png', caption: 'Important diagram' });
  expect(stored.find((block: { type: string }) => block.type === 'card').props).toMatchObject({ title: 'Read the guide', href: 'https://example.com/guide' });
  await page.reload();
  await expect(page.getByText('Read the guide', { exact: true })).toBeVisible();
});
