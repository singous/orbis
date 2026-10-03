import { expect, test, type Locator } from "@playwright/test";

test.use({ screenshot: "off", trace: "off", viewport: { width: 1440, height: 800 } });

const owner = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
const titles = {
  branch: "目录布局分支",
  leaf: "目录布局独立文档：用于验证完整标题提示与较长文字的省略显示",
  child: "目录布局子文档",
  nested: "目录布局嵌套分支",
  active: "目录布局当前文档",
};
const savedBody = "当前文档已经保存的正文。";
const pendingDraft = "尚未保存的编辑草稿。";

async function rowMetrics(row: Locator) {
  return row.evaluate(element => {
    const link = element.querySelector<HTMLAnchorElement>(".document-context-link")!;
    const text = link.querySelector("span")!;
    return {
      textLeft: text.getBoundingClientRect().left,
      height: element.getBoundingClientRect().height,
      weight: getComputedStyle(link).fontWeight,
      background: getComputedStyle(element).backgroundColor,
    };
  });
}

test("directory rows share geometry while side actions and saved previews preserve the read-only main list", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const setup = await request.post("/api/setup", { data: { ...owner, display_name: "目录布局验收" } });
  expect([201, 409]).toContain(setup.status());
  const auth = (await (await request.post("/api/auth/login", { data: owner })).json()).data;
  const headers = { Authorization: `Bearer ${auth.access_token}` };
  const createdNotebook = await request.post("/api/notebooks", { headers, data: { title: `目录布局回归 ${Date.now()}` } });
  expect(createdNotebook.status()).toBe(201);
  const notebookId = (await createdNotebook.json()).data.id as string;
  async function createNote(title: string, sortOrder: number, parentId: string | null = null) {
    const response = await request.post("/api/notes", { headers, data: { notebook_id: notebookId, title, sort_order: sortOrder, parent_id: parentId } });
    expect(response.status()).toBe(201);
    return (await response.json()).data.id as string;
  }
  // Enough neutral siblings make locate-current exercise a real scroll container.
  for (let index = 0; index < 16; index += 1) await createNote(`目录滚动占位 ${index + 1}`, index);
  const branch = await createNote(titles.branch, 16);
  const leaf = await createNote(titles.leaf, 17);
  const child = await createNote(titles.child, 0, branch);
  const nested = await createNote(titles.nested, 1, branch);
  const active = await createNote(titles.active, 0, nested);
  expect((await request.put(`/api/notes/${active}/content`, { headers, data: {
    expected_version: 1,
    blocks: { schema_version: 2, editor: "blocknote", blocks: [{ id: "saved-paragraph", type: "paragraph", props: {}, content: [{ type: "text", text: savedBody, styles: {} }], children: [] }] },
  } })).status()).toBe(200);

  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(owner.email);
  await page.getByLabel("密码", { exact: true }).fill(owner.password);
  await page.getByRole("button", { name: "登录 Orbis", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await page.goto(`/collections/${notebookId}`);
  const main = page.getByRole("navigation", { name: "文档列表", exact: true });
  const sidebar = page.getByRole("navigation", { name: "笔记本文档", exact: true });
  const directory = page.getByRole("region", { name: "文档目录", exact: true });
  const sideRow = (id: string) => sidebar.locator(`.document-context-item[data-note-id="${id}"] > .document-context-row`);

  await expect(main.getByRole("link", { name: titles.active, exact: true })).toBeVisible();
  await expect(main.locator(".document-context-actions, [data-document-drag-row], [data-dragging], [draggable='true'], [aria-keyshortcuts]")).toHaveCount(0);
  await expect(main.getByRole("button", { name: /^(文档操作|预览文档|新建子文档)/ })).toHaveCount(0);
  await expect(directory.getByRole("heading", { name: "目录", exact: true })).toBeVisible();
  await expect(directory.getByRole("button", { name: "定位当前文档", exact: true })).toBeDisabled();

  await main.getByRole("button", { name: `收起子目录 ${titles.branch}`, exact: true }).click();
  await expect(main.getByRole("link", { name: titles.child, exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: titles.child, exact: true })).toBeVisible();
  await directory.getByRole("button", { name: "收起全部目录", exact: true }).click();
  await expect(sidebar.getByRole("link", { name: titles.child, exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: `展开子目录 ${titles.branch}`, exact: true }).click();
  await expect(main.getByRole("link", { name: titles.child, exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: `展开子目录 ${titles.branch}`, exact: true })).toHaveAttribute("aria-expanded", "false");

  await page.goto(`/documents/${active}`);
  const activeLink = sidebar.getByRole("link", { name: titles.active, exact: true });
  await expect(activeLink).toHaveAttribute("aria-current", "page");
  const editor = page.locator(".tiptap.ProseMirror[contenteditable='true']");
  await expect(editor).toContainText(savedBody);
  const branchMetrics = await rowMetrics(sideRow(branch));
  const leafMetrics = await rowMetrics(sideRow(leaf));
  const childMetrics = await rowMetrics(sideRow(child));
  const nestedMetrics = await rowMetrics(sideRow(nested));
  const activeMetrics = await rowMetrics(sideRow(active));
  expect(branchMetrics.textLeft).toBeCloseTo(leafMetrics.textLeft, 1);
  expect(childMetrics.textLeft - branchMetrics.textLeft).toBeCloseTo(24, 1);
  expect(nestedMetrics.textLeft).toBeCloseTo(childMetrics.textLeft, 1);
  expect(activeMetrics.textLeft - nestedMetrics.textLeft).toBeCloseTo(24, 1);
  expect([branchMetrics, leafMetrics, childMetrics, nestedMetrics, activeMetrics].map(metric => metric.height)).toEqual([36, 36, 36, 36, 36]);
  expect(activeMetrics.weight).toBe("600");
  await expect(sidebar.locator('svg[data-orbis-icon="GripVertical"], svg[data-orbis-icon="FileText"]')).toHaveCount(0);
  await expect(sideRow(leaf).locator(".document-tree-prefix svg")).toHaveCount(0);

  const leafLink = sidebar.getByRole("link", { name: titles.leaf, exact: true });
  await expect(leafLink).toHaveAttribute("title", titles.leaf);
  await editor.hover();
  await expect(sideRow(leaf).locator(".document-context-actions")).toHaveCSS("opacity", "0");
  await leafLink.hover();
  await expect(sideRow(leaf).locator(".document-context-actions")).toHaveCSS("opacity", "1");
  await expect.poll(async () => (await rowMetrics(sideRow(leaf))).background).toBe(activeMetrics.background);
  expect(activeMetrics.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(await sideRow(leaf).locator(".document-context-actions > button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")))).toEqual([
    `文档操作 ${titles.leaf}`, `预览文档 ${titles.leaf}`, `新建子文档 ${titles.leaf}`,
  ]);
  expect(await leafLink.locator("span").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);

  const activeUrl = page.url();
  await directory.getByRole("button", { name: "收起全部目录", exact: true }).click();
  await expect(activeLink).toHaveCount(0);
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  await expect(sidebar.getByRole("button", { name: `展开子目录 ${titles.branch}`, exact: true })).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(({ workspaceId, notebookId }) => JSON.parse(localStorage.getItem(`orbis.document-tree.collapsed.${workspaceId}.${notebookId}`) ?? "[]"), { workspaceId: auth.workspace.id, notebookId })).toEqual(expect.arrayContaining([branch, nested]));
  await directory.getByRole("button", { name: "定位当前文档", exact: true }).click();
  await expect(activeLink).toBeFocused();
  await expect(activeLink).toBeInViewport();
  await expect(sidebar.getByRole("button", { name: `收起子目录 ${titles.branch}`, exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByRole("button", { name: `收起子目录 ${titles.nested}`, exact: true })).toHaveAttribute("aria-expanded", "true");
  expect(page.url()).toBe(activeUrl);
  expect(await activeLink.evaluate(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent.scrollTop > 0) return true;
    return false;
  })).toBe(true);
  await directory.getByRole("button", { name: "收起全部目录", exact: true }).click();
  await directory.getByRole("button", { name: "展开全部目录", exact: true }).click();
  await expect(sidebar.getByRole("link", { name: titles.active, exact: true })).toBeVisible();
  await expect(directory.getByRole("button", { name: "收起全部目录", exact: true })).toBeEnabled();

  let releaseSave!: () => void;
  let previewFailure: 500 | 404 | null = null;
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  await page.route(`**/api/notes/${active}/content`, async route => {
    if (route.request().method() === "PUT") await saveGate;
    else if (previewFailure === 500) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "PREVIEW_UNAVAILABLE", message: "预览正文暂不可用", request_id: "preview-read-failure", data: null }) });
      return;
    }
    await route.continue();
  });
  await page.route(`**/api/notes/${active}`, async route => {
    if (route.request().method() === "GET" && previewFailure === 404) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "NOTE_NOT_FOUND", message: "预览文档暂不可用", request_id: "preview-metadata-failure", data: null }) });
      return;
    }
    await route.continue();
  });
  try {
    await editor.click();
    await editor.press("ControlOrMeta+End");
    await editor.pressSequentially(pendingDraft);
    await activeLink.hover();
    const preview = sideRow(active).getByRole("button", { name: `预览文档 ${titles.active}`, exact: true });
    await preview.click();
    const dialog = page.getByRole("dialog", { name: "文档预览", exact: true });
    await expect(dialog.getByText("预览已保存的内容", { exact: true })).toBeVisible();
    await expect(dialog.locator(".document-prose")).toContainText(savedBody);
    await expect(dialog.locator(".document-prose")).not.toContainText(pendingDraft);
    await expect(dialog.locator('[contenteditable="true"]')).toHaveCount(0);
    await expect(dialog.getByRole("link", { name: "打开文档", exact: true })).toHaveAttribute("href", `/documents/${active}`);
    expect(page.url()).toBe(activeUrl);
    await expect(editor).toContainText(pendingDraft);
    expect((await (await request.get(`/api/notes/${active}/content`, { headers })).json()).data.plain_text).toBe(savedBody);
    await dialog.getByRole("button", { name: "关闭预览", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(preview).toBeFocused();
    await expect(editor).toContainText(pendingDraft);
    for (const status of [500, 404] as const) {
      previewFailure = status;
      await preview.click();
      await expect(dialog.getByRole("alert")).toContainText("文档预览加载失败");
      await expect(editor).toHaveCount(1);
      await expect(editor).toContainText(pendingDraft);
      expect(page.url()).toBe(activeUrl);
      await dialog.getByRole("button", { name: "关闭预览", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(preview).toBeFocused();
      await expect(editor).toContainText(pendingDraft);
      expect(page.url()).toBe(activeUrl);
      previewFailure = null;
    }
  } finally { releaseSave(); }
  await expect.poll(async () => (await (await request.get(`/api/notes/${active}/content`, { headers })).json()).data.plain_text).toContain(pendingDraft);
  await page.unroute(`**/api/notes/${active}/content`);
  await page.unroute(`**/api/notes/${active}`);

  await leafLink.hover();
  await sideRow(leaf).getByRole("button", { name: `新建子文档 ${titles.leaf}`, exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建子文档", exact: true });
  await expect(create).toBeVisible();
  await create.getByLabel("文档标题", { exact: true }).fill("目录布局新建子文档");
  await create.getByRole("button", { name: "创建并打开", exact: true }).click();
  await expect(create).toHaveCount(0);
  await expect(page).not.toHaveURL(activeUrl);
  await expect(page.getByRole("textbox", { name: "文档标题", exact: true })).toHaveValue("目录布局新建子文档");
  const createdId = new URL(page.url()).pathname.split("/").at(-1)!;
  expect((await (await request.get(`/api/notes/${createdId}`, { headers })).json()).data.parent_id).toBe(leaf);
});
