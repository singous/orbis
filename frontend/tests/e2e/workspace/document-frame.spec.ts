import {ownerSession,workspacePath} from "../helpers/api-fixtures";
import { expectUnpaintedBoxShadow } from "../helpers/workspace-rendering";
import { expect, test } from '@playwright/test';

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
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expectUnpaintedBoxShadow(page.locator('.workspace-main-area'));
    return page.evaluate(() => {
      const panel = getComputedStyle(document.querySelector('.workspace-main-area')!);
      const grid = getComputedStyle(document.querySelector('.workspace-shell-grid')!);
      const rail = document.querySelector('.workspace-main-navigation')!.getBoundingClientRect();
      const content = document.querySelector(".workspace-main-area")!.getBoundingClientRect();
      return { radius: panel.borderRadius, border: panel.borderTopWidth, gap: content.left - rail.right, padding: grid.paddingLeft, railX: rail.x, railWidth: rail.width };
    });
  }
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const home = await frame('/home');
    const documents = await frame('/documents');
    expect({ radius: documents.radius, border: documents.border }).toEqual({ radius: '0px', border: '0px' });
    expect(documents).toMatchObject({ gap: 0, padding: '0px', railX: 0, railWidth: 272 });
    expect(documents.railWidth).toBe(home.railWidth);
    await expect(page.getByRole('navigation', { name: '文档导航', exact: true })).toBeVisible();
    const navigation = page.getByRole('navigation', { name: '文档导航', exact: true });
    await expect(navigation.getByRole('link', { name: '开始', exact: true })).toHaveAttribute('href', '/documents');
    await expect(navigation.getByRole('link', { name: '数据表', exact: true })).toHaveCount(0);
    await expect(navigation.getByRole('link', { name: '回收站', exact: true })).toBeVisible();
    await expect(navigation.getByRole('link', { name: 'Frame notebook one', exact: true })).toHaveCount(0);
    await expect(navigation.getByRole('button', { name: '收起常用笔记本', exact: true })).toBeVisible();
    const section = page.getByRole('region', { name: 'Frame notebooks', exact: true });
    await expect(section).toBeVisible();
    await expect(page.getByRole('region', { name: 'Empty frame group', exact: true })).toContainText('此分组暂无笔记本');
    const common = await page.getByRole('region', { name: '置顶笔记本', exact: true }).boundingBox();
    const header = await page.locator('.notebook-overview .page-header').boundingBox();
    expect(common!.y - (header!.y + header!.height)).toBeLessThan(40);
    const cards = await section.locator('.notebook-overview-card').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { y: box.y, right: box.right }; }));
    const row = await section.locator('.notebook-overview-grid').boundingBox();
    expect(cards).toHaveLength(2);
    expect(cards[0].y).toBe(cards[1].y);
    expect(cards[1].right).toBeLessThan(row!.x + row!.width);
  }
  for (const path of ['/home', '/documents', '/sites', '/settings/account', '/settings/members']) {
    await page.goto(path);
    await expect(page.locator('.workspace-business-rail').getByRole('button', { name: '切换工作空间', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建资产', exact: true })).toHaveCount(0);
  }
  await page.goto('/documents');
  await page.locator('.notebook-overview .page-actions').getByRole('button', { name: '新建笔记本', exact: true }).click();
  const notebookDialog = page.getByRole('dialog', { name: '新建笔记本', exact: true });
  await notebookDialog.getByLabel('笔记本名称', { exact: true }).fill('Shelf creation notebook');
  await notebookDialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page).toHaveURL(/\/collections\/[^/]+$/);
  await expect(page.locator('.notebook-home .page-title')).toHaveText('Shelf creation notebook');
  await page.goto('/documents');
  await page.locator('.notebook-overview-card-link').first().click();
  const notebookHeader = page.locator('#notebook-directory .workspace-sidebar-header');
  await expect(notebookHeader.getByRole('button', { name: '创建内容', exact: true })).toBeEnabled();
  await expect(page.locator('.workspace-main-navigation > #notebook-directory')).toBeVisible();
  await expect(page.locator('.workspace-shell-grid > #notebook-directory')).toHaveCount(0);
  await expectUnpaintedBoxShadow(page.locator('#notebook-directory'));
  const columnBox = await page.locator('#notebook-directory').boundingBox();
  const titleBox = await page.locator('#notebook-directory .notebook-menu-title').boundingBox();
  const controlsBox = await notebookHeader.boundingBox();
  expect(titleBox!.y).toBeGreaterThanOrEqual(controlsBox!.y + controlsBox!.height);
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(columnBox!.x + columnBox!.width);
  await notebookHeader.getByRole('button', { name: '创建内容', exact: true }).click();
  for (const name of ['随手记', '文档', '数据表']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('menuitem', { name: '画板', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(notebookHeader.getByRole('button', { name: '创建内容', exact: true })).toBeFocused();
  await notebookHeader.getByRole('button', { name: '创建内容', exact: true }).click();
  await expect(page.getByRole('menu', { name: '创建内容', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('notebook-create-menu.png'), animations: 'disabled' });
  await page.getByRole('menuitem', { name: '文档', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[^/]+$/);
  const createdDocumentPath = new URL(page.url()).pathname;
  const createdDocumentLink = page.locator(`#notebook-directory a[href="${createdDocumentPath}"]`);
  await expect(createdDocumentLink).toBeVisible();
  await expect(createdDocumentLink).toHaveText('未命名文档');
  await page.locator('#notebook-directory').getByRole('button', { name: '创建内容', exact: true }).click();
  await page.getByRole('menuitem', { name: '随手记', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/quick-notes$/);
  await expect(page.getByRole("button", { name: "切换工作空间", exact: true })).toBeVisible();
  await page.goto('/documents');
  await page.screenshot({ path: testInfo.outputPath('document-navigation.png') });
  await page.setViewportSize({ width: 390, height: 740 });
  await expect(page.locator('.notebook-overview-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
