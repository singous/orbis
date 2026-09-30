import { expect, test } from '@playwright/test';

const api = `http://127.0.0.1:${process.env.ORBIS_E2E_API_PORT || '9311'}`;
const credentials = { email: 'owner@example.com', password: 'Orbis-browser-test-2026!' };
test.use({ screenshot: 'off', trace: 'off' });

test('document overview shares the home frame and keeps real notebook content near the header', async ({ page, request }) => {
  let response = await request.post(`${api}/setup`, { data: { ...credentials, display_name: 'Document frame regression' } });
  if (response.status() === 409) response = await request.post(`${api}/auth/login`, { data: credentials });
  expect(response.ok()).toBe(true);
  const auth = (await response.json()).data;
  const headers = { Authorization: `Bearer ${auth.access_token}` };
  const group = (await (await request.post(`${api}/document-groups`, { headers, data: { name: 'Frame notebooks', sort_order: 0 } })).json()).data;
  const empty = (await (await request.post(`${api}/document-groups`, { headers, data: { name: 'Empty frame group', sort_order: 1 } })).json()).data;
  expect(empty.id).toBeTruthy();
  for (const title of ['Frame notebook one', 'Frame notebook two']) {
    expect((await request.post(`${api}/notebooks`, { headers, data: { title, group_id: group.id, sort_order: 0 } })).ok()).toBe(true);
  }
  await page.goto('/login');
  await page.getByLabel('邮箱', { exact: true }).fill(credentials.email);
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '登录 Orbis' }).click();
  await expect(page).toHaveURL(/\/documents$/);

  async function frame(path: string) {
    await page.goto(path);
    await expect(page.locator('.page-title')).toBeVisible();
    return page.evaluate(() => {
      const panel = getComputedStyle(document.querySelector('.workspace-main-area')!);
      const grid = getComputedStyle(document.querySelector('.workspace-shell-grid')!);
      const rail = document.querySelector('.workspace-main-navigation')!.getBoundingClientRect();
      const title = document.querySelector('.page-title')!.getBoundingClientRect();
      return { radius: panel.borderRadius, border: panel.borderTopWidth, shadow: panel.boxShadow, gap: grid.columnGap, padding: grid.paddingLeft, railX: rail.x, railWidth: rail.width, titleX: title.x, titleY: title.y };
    });
  }
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const home = await frame('/home');
    expect(await frame('/documents')).toEqual(home);
    const section = page.getByRole('region', { name: 'Frame notebooks', exact: true });
    await expect(section).toBeVisible();
    await expect(page.getByRole('region', { name: 'Empty frame group', exact: true })).toHaveCount(0);
    const heading = await page.locator('.notebook-overview-group h2').first().boundingBox();
    const header = await page.locator('.notebook-overview .page-header').boundingBox();
    expect(heading!.y - (header!.y + header!.height)).toBeLessThan(40);
    const cards = await section.locator('.notebook-overview-card').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { y: box.y, right: box.right }; }));
    const row = await section.locator('.notebook-overview-grid').boundingBox();
    expect(cards).toHaveLength(2);
    expect(cards[0].y).toBe(cards[1].y);
    expect(Math.abs(cards[1].right - (row!.x + row!.width))).toBeLessThan(2);
  }
  const create = page.locator('.workspace-business-rail').getByRole('button', { name: '新建资产', exact: true });
  await expect(create).toBeVisible();
  await create.click();
  await expect(page.getByRole('menuitem', { name: '文档', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '笔记本', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.notebook-overview-card-link').first().click();
  const notebookHeader = page.locator('#notebook-directory .notebook-menu-header');
  await expect(notebookHeader.getByRole('button', { name: '新建文档', exact: true })).toBeEnabled();
  const columnBox = await page.locator('#notebook-directory').boundingBox();
  const titleBox = await notebookHeader.locator('.notebook-menu-title').boundingBox();
  expect(titleBox!.y - columnBox!.y).toBeLessThan(24);
  await expect(create).toBeVisible();
  await page.goto('/documents');
  await page.setViewportSize({ width: 390, height: 740 });
  await expect(page.locator('.notebook-overview-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
