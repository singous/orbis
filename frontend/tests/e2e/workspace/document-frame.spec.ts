import {ownerSession,workspacePath} from "../helpers/api-fixtures";
import { expect, test } from '@playwright/test';

const api = `http://127.0.0.1:${process.env.ORBIS_E2E_API_PORT || '9311'}`;
const credentials = { email: 'owner@example.com', password: 'Orbis-browser-test-2026!' };
test.use({ screenshot: 'off', trace: 'off' });

test('document overview shares the shell and exposes its function menu alongside notebook content', async ({ page, request }, testInfo) => {
  const auth=await ownerSession(request,"Document frame regression");
  const headers = { Authorization: `Bearer ${auth.access_token}` };
  const group = (await (await request.post(workspacePath(auth,"/collection-groups"), { headers, data: { name: 'Frame notebooks', sort_order: 0 } })).json()).data;
  const empty = (await (await request.post(workspacePath(auth,"/collection-groups"), { headers, data: { name: 'Empty frame group', sort_order: 1 } })).json()).data;
  expect(empty.id).toBeTruthy();
  for (const title of ['Frame notebook one', 'Frame notebook two']) {
    expect((await request.post(workspacePath(auth,"/collections"), { headers, data: { title, group_id: group.id, sort_order: 0 } })).ok()).toBe(true);
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
    const documents = await frame('/documents');
    expect({ radius: documents.radius, border: documents.border, shadow: documents.shadow }).toEqual({ radius: '0px', border: '0px', shadow: 'none' });
    expect({ ...documents, railWidth: home.railWidth, titleX: home.titleX }).toEqual(home);
    expect(documents.railWidth).toBeGreaterThan(home.railWidth);
    await expect(page.getByRole('navigation', { name: '文档导航', exact: true })).toBeVisible();
    const navigation = page.getByRole('navigation', { name: '文档导航', exact: true });
    await expect(navigation.getByRole('link', { name: '开始', exact: true })).toHaveAttribute('href', '/documents');
    await expect(navigation.getByRole('link', { name: '数据表', exact: true })).toHaveCount(0);
    await expect(navigation.getByRole('link', { name: '回收站', exact: true })).toBeVisible();
    await expect(navigation.getByRole('link', { name: 'Frame notebook one', exact: true })).toBeVisible();
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
  for (const path of ['/home', '/documents', '/documents/collections', '/sites', '/settings/account', '/settings/members']) {
    await page.goto(path);
    await expect(page.locator('.workspace-business-rail').getByRole('button', { name: '新建资产', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建资产', exact: true })).toHaveCount(1);
  }
  await page.goto('/sites');
  await page.locator('.workspace-business-rail').getByRole('button', { name: '新建资产', exact: true }).click();
  await page.getByRole('button', { name: '笔记本', exact: true }).click();
  const notebookDialog = page.getByRole('dialog', { name: '新建笔记本', exact: true });
  await expect(notebookDialog).toBeVisible();
  await notebookDialog.getByLabel('笔记本名称', { exact: true }).fill('Global creation notebook');
  await notebookDialog.getByRole('button', { name: '创建笔记本', exact: true }).click();
  await expect(page).toHaveURL(/\/collections\/[^/]+$/);
  await expect(page.locator('.notebook-home .page-title')).toHaveText('Global creation notebook');
  await page.goto('/documents');
  const create = page.locator('.workspace-business-rail').getByRole('button', { name: '新建资产', exact: true });
  await expect(create).toBeVisible();
  await create.click();
  await expect(page.getByRole('button', { name: '文档', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '笔记本', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.notebook-overview-card-link').first().click();
  const notebookHeader = page.locator('#notebook-directory .workspace-sidebar-header');
  await expect(notebookHeader.getByRole('button', { name: '创建内容', exact: true })).toBeEnabled();
  await expect(page.locator('.workspace-main-navigation > #notebook-directory')).toBeVisible();
  await expect(page.locator('.workspace-shell-grid > #notebook-directory')).toHaveCount(0);
  expect(await page.locator('#notebook-directory').evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
  const columnBox = await page.locator('#notebook-directory').boundingBox();
  const titleBox = await page.locator('#notebook-directory .notebook-menu-title').boundingBox();
  const controlsBox = await notebookHeader.boundingBox();
  expect(titleBox!.y).toBeGreaterThanOrEqual(controlsBox!.y + controlsBox!.height);
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(columnBox!.x + columnBox!.width);
  await notebookHeader.getByRole('button', { name: '创建内容', exact: true }).click();
  for (const name of ['随手记', '文档', '画板', '数据表']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(notebookHeader.getByRole('button', { name: '创建内容', exact: true })).toBeFocused();
  await notebookHeader.getByRole('button', { name: '创建内容', exact: true }).click();
  await page.getByRole('menu', { name: '创建内容', exact: true }).evaluate(async element => {
    await Promise.all(element.parentElement!.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  await page.screenshot({ path: testInfo.outputPath('notebook-create-menu.png') });
  await page.getByRole('menuitem', { name: '文档', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[^/]+$/);
  const createdDocumentPath = new URL(page.url()).pathname;
  const createdDocumentLink = page.locator(`#notebook-directory a[href="${createdDocumentPath}"]`);
  await expect(createdDocumentLink).toBeVisible();
  await expect(createdDocumentLink).toHaveText('未命名文档');
  await page.locator('#notebook-directory').getByRole('button', { name: '创建内容', exact: true }).click();
  await page.getByRole('menuitem', { name: '随手记', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/quick-notes$/);
  await expect(create).toBeVisible();
  await page.goto('/documents');
  await page.screenshot({ path: testInfo.outputPath('document-navigation.png') });
  await page.setViewportSize({ width: 390, height: 740 });
  await expect(page.locator('.notebook-overview-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
