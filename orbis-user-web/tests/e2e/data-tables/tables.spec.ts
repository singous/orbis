import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const api = `http://127.0.0.1:${process.env.ORBIS_E2E_API_PORT || "9311"}`;
const credentials = {
  email: "owner@example.com",
  password: "Orbis-browser-test-2026!",
};
async function prepare(page: Page, request: APIRequestContext) {
  let auth = await request.post(`${api}/setup`, {
    data: { ...credentials, display_name: "Table acceptance" },
  });
  if (auth.status() === 409)
    auth = await request.post(`${api}/auth/login`, { data: credentials });
  expect(auth.ok()).toBeTruthy();
  const headers = {
    Authorization: `Bearer ${(await auth.json()).data.access_token}`,
  };
  const notebook = (
    await (
      await request.post(`${api}/notebooks`, {
        headers,
        data: { title: "Table acceptance" },
      })
    ).json()
  ).data;
  const note = (
    await (
      await request.post(`${api}/notes`, {
        headers,
        data: { notebook_id: notebook.id, title: "需求列表验收" },
      })
    ).json()
  ).data;
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(credentials.email);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录 Orbis" }).click();
  await page.waitForURL("**/documents");
  await page.goto(`/documents/${note.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const read = async () =>
    (
      await (
        await request.get(`${api}/notes/${note.id}/content`, { headers })
      ).json()
    ).data;
  return { headers, note, notebook, read };
}

test("insert, edit, switch views, expand and reload preserve the same table", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { read, note, headers } = await prepare(page, request);
  await page.getByRole("button", { name: "插入内容", exact: true }).click();
  await page.getByRole("option", { name: "多维表格", exact: true }).click();
  await page.getByRole("button", { name: "创建表格", exact: true }).click();
  await expect(page.getByRole("tab", { name: "全部记录" })).toBeVisible();
  await page.getByRole("button", { name: "添加记录", exact: true }).click();
  const title = page.getByRole("textbox", { name: "标题", exact: true });
  await expect(title).toBeVisible();
  await title.fill("支持多维表格");
  await title.press("Tab");
  const tableId = (await read()).blocks.blocks.find(
    (block: { type: string }) => block.type === "dataTable",
  ).props.table_id;
  const readTable = async () =>
    (
      await (
        await request.get(`${api}/notes/${note.id}/tables/${tableId}`, {
          headers,
        })
      ).json()
    ).data;
  await expect
    .poll(async () => JSON.stringify((await readTable()).records))
    .toContain("支持多维表格");
  await page.getByRole("tab", { name: "按状态" }).click();
  await expect(
    page.getByRole("button", { name: /支持多维表格/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /支持多维表格/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("状态", { exact: true })
    .selectOption({ label: "进行中" });
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await expect(
    page.locator('.dt-board-column[aria-label="进行中"]'),
  ).toContainText("支持多维表格");
  await page.getByRole("button", { name: "展开", exact: true }).click();
  await expect(page.locator(".dt-expanded")).toBeVisible();
  await page.reload();
  await expect(page.locator(".dt-expanded")).toBeVisible();
  await expect(page.getByRole("tab", { name: "按状态" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "全部记录" }).click();
  await expect(
    page.getByRole("textbox", { name: "标题", exact: true }),
  ).toHaveValue("支持多维表格");
  expect(
    (await read()).blocks.blocks.find(
      (block: { type: string }) => block.type === "dataTable",
    ).props.table_id,
  ).toBe(tableId);
  await page.getByRole("button", { name: "返回文档", exact: true }).click();
  await expect(page.locator(".dt-expanded")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("field configuration, visibility and keyboard edits persist through the API", async ({
  page,
  request,
}) => {
  const { read } = await prepare(page, request);
  await page.getByRole("button", { name: "插入内容", exact: true }).click();
  await page.getByRole("option", { name: "多维表格", exact: true }).click();
  await page.getByRole("button", { name: "创建表格", exact: true }).click();
  await page.getByRole("button", { name: "添加字段", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("字段名称").fill("工作量");
  await dialog.getByLabel("字段类型").selectOption("number");
  await dialog.getByRole("button", { name: "保存字段" }).click();
  await expect(
    page.getByRole("columnheader", { name: "工作量" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加记录", exact: true }).click();
  await page.getByRole("spinbutton", { name: "工作量", exact: true }).fill("8");
  await page
    .getByRole("spinbutton", { name: "工作量", exact: true })
    .press("Tab");
  await expect(page.locator(".dt-save")).toHaveText("已保存");
  await page.reload();
  await expect(
    page.getByRole("spinbutton", { name: "工作量", exact: true }),
  ).toHaveValue("8");
  expect((await read()).content_version).toBeGreaterThan(3);
});

test("offline cell drafts survive reload without Web Locks and recover explicitly", async ({
  page,
  request,
  context,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, "locks", { value: undefined }),
  );
  await prepare(page, request);
  await page.getByRole("button", { name: "插入内容", exact: true }).click();
  await page.getByRole("option", { name: "多维表格", exact: true }).click();
  await page.getByRole("button", { name: "创建表格", exact: true }).click();
  await page.getByRole("button", { name: "添加记录", exact: true }).click();
  await expect(page.locator(".dt-save")).toHaveText("已保存");
  await context.setOffline(true);
  const title = page.getByRole("textbox", { name: "标题", exact: true });
  await title.fill("离线表格草稿");
  await title.press("Tab");
  await expect(page.locator(".dt-save")).toHaveText("保存失败");
  await context.setOffline(false);
  await page.reload();
  await page.getByRole("button", { name: "恢复表格草稿 1" }).click();
  await expect(
    page.getByRole("textbox", { name: "标题", exact: true }),
  ).toHaveValue("离线表格草稿");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.locator(".dt-save")).toHaveText("已保存");
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "标题", exact: true }),
  ).toHaveValue("离线表格草稿");
});

test("duplicating a table block creates an independent table and undo restores a cell", async ({
  page,
  request,
}) => {
  const { read } = await prepare(page, request);
  await page.getByRole("button", { name: "插入内容", exact: true }).click();
  await page.getByRole("option", { name: "多维表格", exact: true }).click();
  await page.getByRole("button", { name: "创建表格", exact: true }).click();
  await page.getByRole("button", { name: "添加记录", exact: true }).click();
  const title = page.getByRole("textbox", { name: "标题", exact: true });
  await title.fill("原始记录");
  await title.press("Tab");
  await expect(page.locator(".dt-save")).toHaveText("已保存");
  await title.fill("修改后的记录");
  await title.press("Tab");
  await expect(page.locator(".dt-save")).toHaveText("已保存");
  await page.getByRole("button", { name: "撤销表格操作", exact: true }).click();
  await expect(title).toHaveValue("原始记录");
  await page.locator(".orbis-data-table").hover({ position: { x: 3, y: 3 } });
  await page
    .getByRole("button", { name: "块操作：多维表格", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "创建副本", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await read()).blocks.blocks.filter(
          (block: { type: string }) => block.type === "dataTable",
        ).length,
    )
    .toBe(2);
  const blocks = (await read()).blocks.blocks.filter(
    (block: { type: string }) => block.type === "dataTable",
  );
  expect(blocks[0].props.table_id).not.toBe(blocks[1].props.table_id);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "标题", exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("textbox", { name: "标题", exact: true }).nth(1),
  ).toHaveValue("原始记录");
});
