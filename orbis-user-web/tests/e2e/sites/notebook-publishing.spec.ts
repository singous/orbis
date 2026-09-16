import { expect, test } from "@playwright/test";

const apiOrigin = `http://127.0.0.1:${process.env.ORBIS_E2E_API_PORT || "9311"}`;
const webOrigin = `http://127.0.0.1:${process.env.ORBIS_E2E_WEB_PORT || "9310"}`;
const password = "Orbis-browser-test-2026!";

test("a notebook publishes its complete tree and editable documentation components", async ({ page, browser, request }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/setup");
  await page.getByLabel("显示名称", { exact: true }).fill("文档站点验收");
  await page.getByLabel("邮箱", { exact: true }).fill("owner@example.com");
  await page.getByLabel("密码", { exact: true }).fill(password);
  const setup = page.waitForResponse((response) => response.url().endsWith("/api/setup") && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建并进入工作空间" }).click();
  if ((await setup).status() === 409) {
    await page.goto("/login");
    await page.getByLabel("邮箱", { exact: true }).fill("owner@example.com");
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录 Orbis" }).click();
  }
  await expect(page).toHaveURL(/\/documents$/);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("orbis.auth")!).accessToken as string);
  const headers = { Authorization: `Bearer ${token}` };
  const notebookResponse = await request.post(`${apiOrigin}/notebooks`, { headers, data: { title: "开发者文档" } });
  expect(notebookResponse.status()).toBe(201);
  const notebook = (await notebookResponse.json()).data;
  const ids: string[] = [];
  for (let index = 0; index < 25; index += 1) {
    const response = await request.post(`${apiOrigin}/notes`, { headers, data: {
      notebook_id: notebook.id, title: index === 0 ? "快速开始" : index === 1 ? "安装指南" : index === 2 ? "环境准备" : `使用指南 ${index}`,
      parent_id: index === 1 ? ids[0] : index === 2 ? ids[1] : null, sort_order: index,
    } });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).data.id);
  }
  let blockId = 0;
  function block(type: string, props: Record<string, unknown> = {}, content: unknown = [], children: unknown[] = []) {
    return { id: `component-${++blockId}`, type, props, content, children };
  }
  const paragraph = (text: string) => block("paragraph", {}, [{ type: "text", text }]);
  const blocks = { schema_version: 2, editor: "blocknote", blocks: [
    paragraph("把团队知识整理成清晰、易读的开发者文档。"),
    block("heading", { level: 2 }, [{ type: "text", text: "开始之前" }]),
    block("callout", { title: "开始之前", tone: "info" }, [{ type: "text", text: "文档内容来自笔记本，修改后预览并发布。" }]),
    block("cardGroup", { columns: 2 }, [], [block("card", { title: "原始标题", href: "https://example.com/start" }, [], [paragraph("创建你的第一篇公开文档。")])]),
    block("steps", {}, [], [block("step", { title: "创建笔记本" }, [], [paragraph("按主题整理内容。")]), block("step", { title: "发布站点" }, [], [paragraph("预览后确认公开版本。")])]),
    block("tabs", {}, [], [block("tab", { title: "Linux" }, [], [paragraph("Linux 环境配置")]), block("tab", { title: "macOS" }, [], [paragraph("macOS 环境配置")])]),
    block("codeGroup", {}, [], [block("codeBlock", { language: "python" }, "print('Hello Orbis')"), block("codeBlock", { language: "javascript" }, "console.log('Hello Orbis')")]),
    paragraph(""),
  ] };
  const saved = await request.put(`${apiOrigin}/notes/${ids[0]}/content`, { headers, data: { expected_version: 1, blocks } });
  expect(saved.status()).toBe(200);

  await page.goto(`/documents/${ids[0]}`);
  await page.getByRole("textbox", { name: "卡片标题", exact: true }).fill("阅读入门指南");
  await page.getByRole("button", { name: "添加卡片", exact: true }).click();
  await page.getByRole("textbox", { name: "卡片标题", exact: true }).nth(1).fill("了解发布流程");
  await expect.poll(async () => (await (await request.get(`${apiOrigin}/notes/${ids[0]}/content`, { headers })).json()).data.plain_text).toContain("了解发布流程");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "卡片标题", exact: true }).first()).toHaveValue("阅读入门指南");
  await expect(page.getByRole("textbox", { name: "卡片标题", exact: true }).nth(1)).toHaveValue("了解发布流程");
  await page.locator('[contenteditable="true"]').first().click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/callout");
  await page.getByRole("option", { name: "提示块", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "提示块标题", exact: true })).toHaveCount(2);
  await page.locator('.doc-editor-callout input[value=""]').fill("编辑器插入的提示");
  await expect.poll(async () => (await (await request.get(`${apiOrigin}/notes/${ids[0]}/content`, { headers })).json()).data.plain_text).toContain("编辑器插入的提示");
  const edited = (await (await request.get(`${apiOrigin}/notes/${ids[0]}/content`, { headers })).json()).data.blocks;
  const allowedChildren: Record<string, string> = { cardGroup: "card", steps: "step", tabs: "tab", codeGroup: "codeBlock" };
  type SavedBlock = { type: string; children: SavedBlock[] };
  function expectValidGroupChildren(items: SavedBlock[]) {
    for (const item of items) {
      if (allowedChildren[item.type]) expect(item.children.every((child) => child.type === allowedChildren[item.type])).toBe(true);
      expectValidGroupChildren(item.children);
    }
  }
  expectValidGroupChildren(edited.blocks);
  await page.reload();
  await expect(page.locator('.doc-editor-callout input[value="编辑器插入的提示"]')).toBeVisible();

  await page.goto(`/collections/${notebook.id}`);
  await page.getByRole("link", { name: "创建文档站点", exact: true }).click();
  const create = page.getByRole("dialog", { name: "创建文档站点" });
  await expect(create.getByRole("radio", { name: "关联笔记本" })).toBeChecked();
  await expect(create.getByLabel("来源笔记本 1")).toHaveValue(notebook.id);
  await create.getByLabel("站点名称", { exact: true }).fill("Orbis 开发者文档");
  await create.getByLabel("站点路径", { exact: false }).fill("notebook-docs");
  await create.getByLabel("站点简介", { exact: true }).fill("从笔记本持续发布产品知识。");
  await create.getByRole("button", { name: "创建站点", exact: true }).click();
  await expect(page).toHaveURL(/\/sites\/[0-9a-f-]+$/);
  const siteId = page.url().split("/").pop()!;
  await expect(page.getByText("当前解析 25 篇 · 排除 0 篇", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "发布站点", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "确认发布站点" });
  await expect(preview.getByText("25 篇页面", { exact: true })).toBeVisible();
  await expect(preview.getByRole("navigation", { name: "预览页面" }).getByRole("button")).toHaveCount(25);
  await expect(preview.getByRole("link", { name: "阅读入门指南" })).toBeVisible();
  await preview.getByRole("button", { name: "确认发布", exact: true }).click();
  await expect(page.getByText("站点已发布，读者现在可以访问新版本。", { exact: true })).toBeVisible();
  const snapshot = (await (await request.get(`${apiOrigin}/public/sites/notebook-docs`)).json()).data;
  expect(snapshot.pages).toHaveLength(25);
  expect(snapshot.pages[2].parent_slug).toBe(snapshot.pages[1].slug);

  const guest = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const reader = await guest.newPage();
  reader.on("pageerror", (error) => errors.push(error.message));
  await reader.goto(`${webOrigin}/s/notebook-docs/${encodeURIComponent(snapshot.pages[0].slug)}`);
  await expect(reader.getByRole("heading", { name: "快速开始", level: 1 })).toBeVisible();
  await expect(reader.getByRole("note", { name: "开始之前" })).toContainText("文档内容来自笔记本");
  await expect(reader.getByRole("note", { name: "编辑器插入的提示" })).toBeVisible();
  await expect(reader.getByRole("list", { name: "步骤" })).toContainText("创建笔记本");
  await reader.getByRole("tab", { name: "macOS", exact: true }).click();
  await expect(reader.getByText("macOS 环境配置", { exact: true })).toBeVisible();
  await reader.getByRole("tab", { name: "JavaScript", exact: true }).click();
  await expect(reader.getByLabel("JavaScript 代码", { exact: true })).toContainText("console.log('Hello Orbis')");
  await expect(reader.locator(".content-code:visible .hljs-string")).toBeVisible();
  await reader.getByRole("button", { name: "复制代码", exact: true }).click();
  expect(await reader.evaluate(() => navigator.clipboard.readText())).toBe("console.log('Hello Orbis')");
  await reader.evaluate(() => window.scrollTo(0, 0));
  await reader.screenshot({ path: testInfo.outputPath("components-desktop.png"), fullPage: true });
  await reader.getByRole("button", { name: "搜索文档", exact: true }).click();
  const search = reader.getByRole("combobox", { name: "搜索文档", exact: true });
  await search.fill("使用指南 24");
  await expect(reader.getByRole("option", { name: /使用指南 24/ })).toBeVisible();
  await search.press("Escape");
  await reader.getByRole("button", { name: "当前跟随系统主题，切换为浅色主题" }).click();
  await reader.getByRole("button", { name: "切换深色主题" }).click();
  const darkColors = await reader.evaluate(() => ({
    prose: getComputedStyle(document.querySelector(".document-prose")!).color,
    callout: getComputedStyle(document.querySelector(".doc-callout")!).color,
  }));
  expect(darkColors.callout).toBe(darkColors.prose);
  await reader.evaluate(() => window.scrollTo(0, 0));
  await reader.screenshot({ path: testInfo.outputPath("components-dark.png"), fullPage: true });
  await reader.setViewportSize({ width: 390, height: 844 });
  await reader.evaluate(() => window.scrollTo(0, 0));
  expect(await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await reader.screenshot({ path: testInfo.outputPath("components-mobile.png"), fullPage: true });
  await reader.getByRole("button", { name: "打开站点导航" }).click();
  const navigation = reader.getByRole("navigation", { name: "站点导航", exact: true });
  await expect(navigation.getByRole("link", { name: "快速开始", exact: true })).toBeVisible();
  await navigation.getByRole("link", { name: "快速开始", exact: true }).click();
  await expect(reader.getByRole("heading", { name: "快速开始", level: 1 })).toBeVisible();
  expect(siteId).toMatch(/^[a-f0-9-]+$/);
  await guest.close();
  expect(errors).toEqual([]);
});
