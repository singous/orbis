import { expect, test } from '@playwright/test';

const api = `http://127.0.0.1:${process.env.ORBIS_E2E_API_PORT || '9311'}`;
const credentials = { email: 'owner@example.com', password: 'Orbis-browser-test-2026!' };

test.use({ screenshot: 'off', trace: 'off' });
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 740 }]) {
  test(`document chrome remains usable at the start, middle and end (${viewport.width}px)`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    let response = await request.post(`${api}/setup`, { data: { ...credentials, display_name: 'Editor chrome acceptance' } });
    if (response.status() === 409) response = await request.post(`${api}/auth/login`, { data: credentials });
    expect(response.ok()).toBe(true);
    const auth = (await response.json()).data;
    const headers = { Authorization: `Bearer ${auth.access_token}` };
    const notebook = (await (await request.post(`${api}/notebooks`, { headers, data: { title: 'Editor chrome notebook' } })).json()).data;
    const note = (await (await request.post(`${api}/notes`, { headers, data: { notebook_id: notebook.id, title: 'A long document with persistent tools' } })).json()).data;
    const blocks = Array.from({ length: 90 }, (_, index) => ({ id: `chrome-${index}`, type: 'paragraph', props: {}, content: [{ type: 'text', text: `Paragraph ${index + 1}. The document keeps navigation and formatting controls within reach while editing.` }], children: [] }));
    expect((await request.put(`${api}/notes/${note.id}/content`, { headers, data: { expected_version: 1, blocks: { schema_version: 2, editor: 'blocknote', blocks } } })).ok()).toBe(true);
    await page.goto('/login');
    await page.getByLabel('邮箱', { exact: true }).fill(credentials.email);
    await page.getByLabel('密码', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: '登录 Orbis' }).click();
    await expect(page).toHaveURL(/\/documents$/);
    await page.goto(`/documents/${note.id}`);
    const toolbar = page.getByRole('toolbar', { name: '文档格式' });
    const breadcrumb = page.getByRole('navigation', { name: '文档位置' });
    await expect(toolbar).toBeVisible();
    await expect(breadcrumb).toContainText(notebook.title);
    const originalTop = (await toolbar.boundingBox())!.y;
    const scroller = page.locator('.document-scroll-region');
    const paragraphs = page.locator('.ProseMirror > p');
    for (const index of [0, 45, 89]) {
      // Long documents expose later paragraphs after a real scroll requests
      // their range; verify the same tools once that range is visible.
      while (await paragraphs.count() <= index) {
        const loaded = await paragraphs.count();
        await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await expect.poll(() => paragraphs.count()).toBeGreaterThan(loaded);
      }
      const paragraph = paragraphs.nth(index);
      await paragraph.scrollIntoViewIfNeeded();
      await paragraph.click();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Shift+ArrowRight');
      await expect(toolbar).toBeInViewport();
      await expect(breadcrumb).toBeInViewport();
      expect((await toolbar.boundingBox())!.y).toBeCloseTo(originalTop, 0);
      await toolbar.getByRole('button', { name: '粗体', exact: true }).click();
      await expect(paragraph.locator('strong')).toBeVisible();
      await toolbar.getByRole('button', { name: '撤销', exact: true }).click();
      await expect(paragraph.locator('strong')).toHaveCount(0);
      await expect(paragraph).toBeInViewport();
      await toolbar.getByRole('button', { name: '插入内容', exact: true }).click();
      await expect(page.getByRole('listbox', { name: '插入内容' })).toBeInViewport();
      await page.keyboard.press('Escape');
    }
    expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(1000);
    if (viewport.width < 700) {
      await toolbar.getByRole('button', { name: '更多格式' }).click();
      await page.getByRole('menuitem', { name: '当前块操作', exact: true }).click();
      await expect(page.getByRole('menu', { name: '块操作', exact: true })).toBeInViewport();
      await expect(page.getByRole('menuitem', { name: '粘贴块', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-orbis-selected="true"]')).toHaveCount(0);
    }
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(paragraphs.nth(89)).toBeInViewport();
    if (viewport.width < 700) {
      const controls = await page.locator('.orbis-block-controls').boundingBox();
      const body = await paragraphs.nth(89).boundingBox();
      if (controls && body) expect(controls.x + controls.width).toBeLessThanOrEqual(body.x);
    }
    await expect(toolbar).toBeInViewport();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await expect.poll(() => page.locator('.block-add').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('oklch(0.2103 0.0248 273.85)');

    await page.getByRole('button', { name: '更多文档操作' }).click();
    await expect(page.getByRole('menuitem', { name: '归档文档' })).toBeInViewport();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
