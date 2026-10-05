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

test("editing an oversized drawing hydrates its original scene before opening", async ({ page, request }) => {
  const { note, headers, read } = await prepare(page, request);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/uXcAAAAASUVORK5CYII=", "base64");
  const upload = await request.post("/api/files", { headers, multipart: { file: { name: "drawing.png", mimeType: "image/png", buffer: png } } });
  expect(upload.status()).toBe(201);
  const points = Array.from({ length: 18000 }, (_, index) => [index / 10, index % 40]);
  const scene = JSON.stringify({ version: 1, elements: [{ id: "large-stroke", type: "freedraw", x: 0, y: 0, width: 1800, height: 40, points, pressures: [], simulatePressure: true }], appState: { viewBackgroundColor: "#ffffff" } });
  expect(Buffer.byteLength(scene)).toBeGreaterThan(128 * 1024);
  const block = { id: "large-drawing", type: "drawing", props: { scene, caption: "大型画板", url: `orbis-file:${(await upload.json()).data.id}` }, content: [], children: [] };
  const response = await request.put(`/api/notes/${note.id}/content`, { headers, data: { expected_version: 2, blocks: { schema_version: 2, editor: "blocknote", blocks: [paragraph, block] } } });
  expect(response.status(), await response.text()).toBe(200);
  await page.reload();
  await expect(page.getByRole("button", { name: "展开正文", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑画板", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "编辑画板", exact: true })).toBeVisible();
  await expect(page.getByLabel("画板名称", { exact: true })).toHaveValue("大型画板");
  await page.getByRole("button", { name: "保存画板", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "编辑画板", exact: true })).toHaveCount(0);
  await expect.poll(async () => JSON.parse((await read()).blocks.blocks.find((value: { type: string }) => value.type === "drawing").props.scene).elements[0].points.length).toBe(18000);
});
