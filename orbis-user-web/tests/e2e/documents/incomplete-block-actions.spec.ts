import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const api = `http://127.0.0.1:${process.env.ORBIS_E2E_API_PORT || '9311'}`;
const credentials = { email: 'owner@example.com', password: 'Orbis-browser-test-2026!' };
const paragraph = (id: string, text: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: { bold: true } }], children: [] });

async function prepare(page: Page, request: APIRequestContext, blocks: unknown[]) {
  let auth = await request.post(`${api}/setup`, { data: { ...credentials, display_name: 'Complete block actions' } });
  if (auth.status() === 409) auth = await request.post(`${api}/auth/login`, { data: credentials });
  expect(auth.ok()).toBe(true);
  const headers = { Authorization: `Bearer ${(await auth.json()).data.access_token}` };
  const notebook = (await (await request.post(`${api}/notebooks`, { headers, data: { title: 'Complete action fixtures' } })).json()).data;
  const note = (await (await request.post(`${api}/notes`, { headers, data: { notebook_id: notebook.id, title: 'Unexpanded block actions' } })).json()).data;
  expect((await request.put(`${api}/notes/${note.id}/content`, { headers, data: { expected_version: 1, blocks: { schema_version: 2, editor: 'blocknote', blocks } } })).ok()).toBe(true);
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill(credentials.email);
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '登录 Orbis' }).click();
  await page.waitForURL('**/documents');
  await page.goto(`/documents/${note.id}`);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  return { note, notebook, headers, read: async () => (await (await request.get(`${api}/notes/${note.id}/content`, { headers })).json()).data };
}

async function openMenu(page: Page, target: ReturnType<Page['locator']>) {
  await target.hover({ position: { x: 2, y: 2 } });
  await page.getByRole('button', { name: /^块操作：/ }).click();
}

for (const action of ['创建副本', '取消组合'] as const) {
  test(`${action} reads an unexpanded group and preserves nested content without reading unrelated groups`, async ({ page, request }) => {
    const child = paragraph('body', 'Retained unexpanded group body');
    const group = { id: 'target', type: 'group', props: {}, content: [], children: [child, { id: 'nested', type: 'group', props: {}, content: [], children: [paragraph('deep', 'Retained nested body')] }] };
    const { note, read } = await prepare(page, request, [group, { id: 'unrelated', type: 'card', props: { title: 'Unrelated card' }, content: [], children: [paragraph('private-tail', 'Unrelated body')] }]);
    const parents: string[] = [];
    page.on('request', message => { const url = new URL(message.url()); if (url.pathname.endsWith(`/notes/${note.id}/content/children`) && url.searchParams.has('parent_id')) parents.push(url.searchParams.get('parent_id')!); });
    expect((await read()).content_version).toBe(2);
    await expect(page.getByText('Retained unexpanded group body', { exact: true })).toHaveCount(0);
    await openMenu(page, page.locator('[data-block-loader="target"]'));
    await expect(page.getByRole('menuitem', { name: action, exact: true })).toBeEnabled();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
    await expect.poll(async () => (await read()).content_version).toBeGreaterThan(2);
    const stored = (await read()).blocks.blocks;
    expect(parents).toEqual(['target', 'nested']);
    expect(stored.at(-1).id).toBe('unrelated');
    expect(stored.at(-1).children[0].id).toBe('private-tail');
    if (action === '创建副本') {
      expect(stored).toHaveLength(3);
      const duplicated = stored.filter((block: { type: string }) => block.type === 'group');
      expect(duplicated).toHaveLength(2);
      for (const item of duplicated) {
        expect(item.children[0].content).toEqual(child.content);
        expect(item.children[1].children[0].content[0].text).toBe('Retained nested body');
      }
      expect(duplicated[0].children[0].id).not.toBe(duplicated[1].children[0].id);
    } else {
      expect(stored.map((block: { id: string }) => block.id)).toEqual(['body', 'nested', 'unrelated']);
      expect(stored[0].content).toEqual(child.content);
      expect(stored[1].children[0].id).toBe('deep');
    }
    await page.reload();
    expect((await read()).blocks.blocks).toEqual(stored);
  });
}

test('the LAN clipboard fallback copies only the selected paged subtree with its formatting', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const children = Array.from({ length: 40 }, (_, index) => paragraph(`child-${index}`, `Selected child ${index}`));
  const { note, notebook, headers, read } = await prepare(page, request, [
    { id: 'card', type: 'card', props: { title: 'Selected card' }, content: [], children },
    { id: 'other', type: 'card', props: { title: 'Other card' }, content: [], children: [paragraph('unrelated', 'Do not read this subtree')] },
  ]);
  const parents: string[] = [];
  page.on('request', message => { const url = new URL(message.url()); if (url.pathname.endsWith(`/notes/${note.id}/content/children`) && url.searchParams.has('parent_id')) parents.push(url.searchParams.get('parent_id')!); });
  // Force the same clipboard path used on non-secure LAN HTTP origins.
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); });
  await openMenu(page, page.locator('.doc-editor-title').getByText('Selected card', { exact: true }));
  await page.getByRole('menuitem', { name: '复制块', exact: true }).click();
  await expect(page.locator('.orbis-block-notice')).toContainText('已复制');
  expect(parents).toEqual(['card', 'card']);
  expect((await read()).content_version).toBe(2);
  const destination = (await (await request.post(`${api}/notes`, { headers, data: { notebook_id: notebook.id, title: 'Fallback paste target' } })).json()).data;
  await page.goto(`/documents/${destination.id}`);
  await page.locator('.ProseMirror').click(); await page.keyboard.press('ControlOrMeta+V');
  const copied = async () => (await (await request.get(`${api}/notes/${destination.id}/content`, { headers })).json()).data;
  await expect.poll(async () => (await copied()).plain_text).toContain('Selected child 39');
  const card = (await copied()).blocks.blocks.find((block: { type: string }) => block.type === 'card');
  expect(card.children).toHaveLength(40);
  expect(card.children.map((item: { content: unknown }) => item.content)).toEqual(children.map(item => item.content));
  expect((await copied()).plain_text).not.toContain('Do not read this subtree');
});

for (const input of ['menu', 'keyboard'] as const) {
  test(`${input} cut leaves the source intact when selected children cannot be read`, async ({ page, request }) => {
    const { note, read } = await prepare(page, request, [{ id: 'card', type: 'card', props: { title: 'Fail-safe card' }, content: [], children: [paragraph('retained', 'Never remove this child')] }, paragraph('neighbor', 'Retained neighbor')]);
    const before = await read();
    await page.route('**/api/notes/*/content/children?*', async route => {
      if (new URL(route.request().url()).searchParams.get('parent_id') === 'card') await route.fulfill({ status: 503, json: { code: 'READ_UNAVAILABLE', message: 'Subtree unavailable' } });
      else await route.continue();
    });
    const writes: string[] = [];
    page.on('request', message => { if (message.method() === 'PATCH' && message.url().includes(`/notes/${note.id}/`)) writes.push(message.url()); });
    await openMenu(page, page.locator('.doc-editor-title').getByText('Fail-safe card', { exact: true }));
    if (input === 'menu') await page.getByRole('menuitem', { name: /剪切块$/ }).click();
    else { await page.keyboard.press('Escape'); await page.locator('.ProseMirror').press('ControlOrMeta+X'); }
    await expect(page.locator('.orbis-block-notice')).toContainText('原内容已保留');
    expect(writes).toEqual([]);
    expect(await read()).toEqual(before);
    await expect(page.getByText('Fail-safe card', { exact: true })).toBeVisible();
  });
}

test('cut reads an unexpanded card before removing it and preserves its children on paste', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const child = paragraph('moved-body', 'Move the full card body');
  const { notebook, headers, read } = await prepare(page, request, [
    { id: 'cut-card', type: 'card', props: { title: 'Cut this card' }, content: [], children: [child] },
    { id: 'neighbor', type: 'card', props: { title: 'Leave this card' }, content: [], children: [paragraph('neighbor-child', 'Keep the unopened neighbor')] },
  ]);
  const destination = (await (await request.post(`${api}/notes`, { headers, data: { notebook_id: notebook.id, title: 'Cut paste target' } })).json()).data;
  await expect(page.getByText('Move the full card body', { exact: true })).toHaveCount(0);
  await openMenu(page, page.locator('.doc-editor-title').getByText('Cut this card', { exact: true }));
  await page.getByRole('menuitem', { name: /剪切块$/ }).click();
  await expect(page.locator('.orbis-block-notice')).toContainText('已剪切');
  await expect.poll(async () => (await read()).blocks.blocks.map((block: { id: string }) => block.id).join(',')).toBe('neighbor');
  expect((await read()).blocks.blocks[0].children[0].id).toBe('neighbor-child');
  await page.goto(`/documents/${destination.id}`);
  await page.locator('.ProseMirror').click(); await page.keyboard.press('ControlOrMeta+V');
  const pasted = async () => (await (await request.get(`${api}/notes/${destination.id}/content`, { headers })).json()).data;
  await expect.poll(async () => (await pasted()).plain_text).toContain('Move the full card body');
  const card = (await pasted()).blocks.blocks.find((block: { type: string }) => block.type === 'card');
  expect(card.props.title).toBe('Cut this card');
  expect(card.children[0].content).toEqual(child.content);
  expect((await pasted()).plain_text).not.toContain('Keep the unopened neighbor');
});
