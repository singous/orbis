import { expect, test } from "@playwright/test";

const credentials = {
  email: "owner@example.com",
  password: "Orbis-browser-test-2026!",
};

test("drawing and table edits preserve both embedded blocks through reload and publication", async ({
  page,
  request,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const setup = await request.post("/api/setup", {
    data: { ...credentials, display_name: "Embedded components acceptance" },
  });
  expect([201, 409]).toContain(setup.status());
  const login = await request.post("/api/auth/login", { data: credentials });
  expect(login.ok()).toBeTruthy();
  const headers = {
    Authorization: `Bearer ${(await login.json()).data.access_token}`,
  };
  const notebook = (
    await (
      await request.post("/api/notebooks", {
        headers,
        data: { title: "Embedded components acceptance" },
      })
    ).json()
  ).data;
  const note = (
    await (
      await request.post("/api/notes", {
        headers,
        data: { notebook_id: notebook.id, title: "画板与表格共同验收" },
      })
    ).json()
  ).data;
  const body = {
    id: "mixed-body",
    type: "paragraph",
    props: {},
    content: [{ type: "text", text: "画板与表格旁的正文" }],
    children: [],
  };
  const initial = await request.put(`/api/notes/${note.id}/content`, {
    headers,
    data: {
      expected_version: 1,
      blocks: { schema_version: 2, editor: "blocknote", blocks: [body] },
    },
  });
  expect(initial.ok()).toBeTruthy();
  const read = async () =>
    (await (await request.get(`/api/notes/${note.id}/content`, { headers })).json()).data;

  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录 Orbis" }).click();
  await page.waitForURL("**/documents");
  await page.goto(`/documents/${note.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.locator(".ProseMirror > p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/drawing");
  await page.getByRole("option", { name: "画板", exact: true }).click();
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  await expect(page.getByTestId("toolbar-rectangle")).toBeAttached();
  await page.getByLabel("画板名称", { exact: true }).fill("共同文档的流程图");
  await page.getByTestId("toolbar-rectangle").click({ force: true });
  const canvas = (await page.locator(".drawing-editor-surface canvas").last().boundingBox())!;
  const x = canvas.x + canvas.width * 0.48;
  const y = canvas.y + canvas.height * 0.44;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 80, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "保存画板", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "编辑画板", exact: true })).toHaveCount(0);
  await expect.poll(async () =>
    (await read()).blocks.blocks.find((block: { type: string }) => block.type === "drawing")?.props.url,
  ).toMatch(/^orbis-file:/);
  const drawing = (await read()).blocks.blocks.find(
    (block: { type: string }) => block.type === "drawing",
  );
  const scene = JSON.parse(drawing.props.scene);
  expect(scene.elements).toHaveLength(1);
  expect(scene.elements[0].type).toBe("rectangle");

  await page.locator(".ProseMirror > p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "插入内容", exact: true }).click();
  await page.getByRole("option", { name: "多维表格", exact: true }).click();
  await page.getByRole("button", { name: "创建表格", exact: true }).click();
  await expect(page.getByRole("tab", { name: "全部记录" })).toBeVisible();
  await expect.poll(async () =>
    (await read()).blocks.blocks.some((block: { type: string }) => block.type === "dataTable"),
  ).toBe(true);
  expect((await read()).blocks.blocks.map((block: { type: string }) => block.type)).toEqual(
    expect.arrayContaining(["drawing", "dataTable"]),
  );
  const table = (await read()).blocks.blocks.find(
    (block: { type: string }) => block.type === "dataTable",
  );
  const readTable = async () =>
    (await (await request.get(`/api/notes/${note.id}/tables/${table.props.table_id}`, { headers })).json()).data;
  await page.getByRole("button", { name: "添加记录", exact: true }).click();
  const title = page.getByRole("textbox", { name: "标题", exact: true });
  await title.fill("画板对应的实现任务");
  await title.press("Tab");
  await expect.poll(async () => JSON.stringify((await readTable()).records)).toContain("画板对应的实现任务");
  await title.fill("画板对应的实现任务已更新");
  await title.press("Tab");
  await expect.poll(async () => JSON.stringify((await readTable()).records)).toContain("画板对应的实现任务已更新");
  await expect(page.locator(".dt-save")).toHaveText("已保存");

  await page.reload();
  await expect(page.locator("[data-drawing-block] img")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "标题", exact: true })).toHaveValue("画板对应的实现任务已更新");
  const content = (await read()).blocks.blocks;
  expect(content.find((block: { id: string }) => block.id === drawing.id).props).toEqual(drawing.props);
  expect(content.find((block: { type: string }) => block.type === "dataTable").props.table_id).toBe(table.props.table_id);
  expect(content.some((block: { id: string }) => block.id === body.id)).toBe(true);
  expect((await readTable()).records).toHaveLength(1);

  const siteResponse = await request.post("/api/sites", {
    headers,
    data: {
      name: "Embedded components acceptance",
      slug: "embedded-components-acceptance",
      navigation: [{ note_id: note.id, slug: "guide", title: "共同文档" }],
    },
  });
  expect(siteResponse.status()).toBe(201);
  const site = (await siteResponse.json()).data;
  const published = await request.post(`/api/sites/${site.id}/publish`, { headers });
  expect(published.status(), await published.text()).toBe(200);
  const anonymous = await browser.newContext();
  try {
    const reader = await anonymous.newPage();
    reader.on("pageerror", (error) => errors.push(error.message));
    const response = await reader.goto(new URL("/s/embedded-components-acceptance/guide", page.url()).href);
    expect(response?.status()).toBe(200);
    const html = await response!.text();
    expect(html).toContain("<img");
    expect(html).toContain("画板对应的实现任务已更新");
    expect(html).not.toContain('"scene"');
    await expect(reader.locator("[data-drawing-block] img")).toBeVisible();
    await expect.poll(() => reader.locator("[data-drawing-block] img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(reader.locator(".dt-snapshot")).toContainText("画板对应的实现任务已更新");
    await expect(reader.locator(".dt-snapshot")).toContainText("1 条记录 · 发布快照");
    await expect(reader.getByRole("button", { name: "编辑画板", exact: true })).toHaveCount(0);
    await expect(reader.getByRole("textbox", { name: "标题", exact: true })).toHaveCount(0);
  } finally {
    await anonymous.close();
  }
  expect(errors).toEqual([]);
});
