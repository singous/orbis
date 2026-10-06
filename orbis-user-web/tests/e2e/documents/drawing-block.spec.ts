import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

const credentials = { email: "owner@example.com", password: "Orbis-browser-test-2026!" };
const paragraph = { id: "body", type: "paragraph", props: {}, content: [{ type: "text", text: "画板旁的正文" }], children: [] };

async function prepare(page: Page, request: APIRequestContext) {
  const setup = await request.post("/api/setup", { data: { ...credentials, display_name: "Drawing acceptance" } });
  expect([201, 409]).toContain(setup.status());
  const login = (await (await request.post("/api/auth/login", { data: credentials })).json()).data;
  const headers = { Authorization: `Bearer ${login.access_token}` };
  const notebook = (await (await request.post("/api/notebooks", { headers, data: { title: "Drawing notebook" } })).json()).data;
  const note = (await (await request.post("/api/notes", { headers, data: { notebook_id: notebook.id, title: "画板验收" } })).json()).data;
  const save = await request.put(`/api/notes/${note.id}/content`, { headers, data: { expected_version: 1, blocks: { schema_version: 2, editor: "blocknote", blocks: [paragraph] } } });
  expect(save.ok()).toBeTruthy();
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录 Orbis" }).click();
  await page.waitForURL("**/documents");
  await page.goto(`/documents/${note.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  return { note, headers, read: async () => (await (await request.get(`/api/notes/${note.id}/content`, { headers })).json()).data };
}

async function insert(page: Page) {
  await page.locator(".ProseMirror > p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/drawing");
  await page.getByRole("option", { name: "画板", exact: true }).click();
  await expect(page.locator("[data-drawing-block]")).toBeVisible();
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "编辑画板", exact: true })).toBeVisible();
  await expect(page.getByTestId("toolbar-rectangle")).toBeAttached();
}

async function draw(page: Page, type: "rectangle" | "ellipse" | "arrow" | "freedraw", offset = 0) {
  await page.getByTestId(`toolbar-${type}`).click({ force: true });
  const box = (await page.locator(".drawing-editor-surface canvas").last().boundingBox())!;
  const x = box.x + box.width * 0.48 + offset;
  const y = box.y + box.height * 0.44;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 80, { steps: 8 });
  await page.mouse.up();
}

test("a real drawing survives upload retry, reload and re-editing and publishes a frozen preview", async ({ page, request, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const { note, headers, read } = await prepare(page, request);
  const external: string[] = [];
  page.on("request", request => { if (/esm\.run|excalidraw\.com/.test(request.url())) external.push(request.url()); });
  await insert(page);
  await page.getByLabel("画板名称", { exact: true }).fill("流程草图");
  await draw(page, "rectangle");
  await draw(page, "arrow", 140);
  await draw(page, "freedraw", -110);
  await page.getByTestId("toolbar-text").click({ force: true });
  const box = (await page.locator(".drawing-editor-surface canvas").last().boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.73);
  await page.keyboard.insertText("保存后继续绘制");
  await page.keyboard.press("Escape");
  let fail = true;
  await page.route("**/api/files", async route => {
    if (route.request().method() === "POST" && fail) { fail = false; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "预览上传暂时失败" } }) }); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "保存画板", exact: true }).click();
  await expect(page.locator(".drawing-error")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "编辑画板", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存画板", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "编辑画板", exact: true })).toHaveCount(0);
  await expect.poll(async () => (await read()).blocks.blocks.find((block: { type: string }) => block.type === "drawing")?.props.url).toMatch(/^orbis-file:/);
  const stored = (await read()).blocks.blocks.find((block: { type: string }) => block.type === "drawing");
  const scene = JSON.parse(stored.props.scene);
  expect(scene.elements.map((element: { type: string }) => element.type)).toEqual(expect.arrayContaining(["rectangle", "arrow", "freedraw", "text"]));
  expect(scene.elements.find((element: { type: string }) => element.type === "text").text).toBe("保存后继续绘制");
  await page.reload();
  await expect(page.locator("[data-drawing-block] img")).toBeVisible();
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  await expect(page.getByTestId("toolbar-ellipse")).toBeAttached();
  await draw(page, "ellipse", -150);
  await page.getByRole("button", { name: "保存画板", exact: true }).click();
  await expect.poll(async () => JSON.parse((await read()).blocks.blocks.find((block: { type: string }) => block.type === "drawing").props.scene).elements.length).toBe(scene.elements.length + 1);
  expect((await read()).blocks.blocks.some((block: { id: string }) => block.id === "body")).toBe(true);

  const siteResponse = await request.post("/api/sites", { headers, data: { name: "Drawing site", slug: "drawing-acceptance", navigation: [{ note_id: note.id, slug: "guide", title: "画板指南" }] } });
  expect(siteResponse.status()).toBe(201);
  const site = (await siteResponse.json()).data;
  const published = await request.post(`/api/sites/${site.id}/publish`, { headers });
  expect(published.status(), await published.text()).toBe(200);
  const anonymous = await browser.newContext();
  const reader = await anonymous.newPage();
  reader.on("pageerror", error => errors.push(error.message));
  const response = await reader.goto(new URL("/s/drawing-acceptance/guide", page.url()).href);
  expect(response?.status()).toBe(200);
  const html = await response!.text();
  expect(html).toContain("<img");
  expect(html).not.toContain('"scene"');
  await expect(reader.locator("[data-drawing-block] img")).toBeVisible();
  await expect.poll(() => reader.locator("[data-drawing-block] img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(reader.getByRole("button", { name: "编辑画板", exact: true })).toHaveCount(0);
  await reader.getByRole("button", { name: "放大查看画板" }).click();
  await expect(reader.getByRole("dialog", { name: "流程草图" })).toBeVisible();
  await anonymous.close();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("cancel preserves the saved drawing and document history can remove its insertion", async ({ page, request }) => {
  const { read } = await prepare(page, request);
  await insert(page);
  await draw(page, "rectangle");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "继续编辑" }).click();
  await expect(page.getByRole("dialog", { name: "编辑画板", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect.poll(async () => (await read()).blocks.blocks.find((block: { type: string }) => block.type === "drawing")?.props.scene).toBe("");
  await page.getByRole("toolbar", { name: "文档格式" }).getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await read()).blocks.blocks.some((block: { type: string }) => block.type === "drawing")).toBe(false);
});
