import { expect, test } from "@playwright/test";
import {
  ownerSession,
  createCollection,
  openWithSession,
  responseData,
  workspacePath,
  sessionHeaders,
} from "../helpers/api-fixtures";

test("table, field menus, board and public collection share the same records", async ({
  page,
  request,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const session = await ownerSession(request),
    collection = await createCollection(
      request,
      session,
      `数据表 ${Date.now()}`,
    );
  await openWithSession(page, session, `/sheets?collection=${collection.id}`);
  await page
    .locator(".page-actions")
    .getByRole("button", { name: "新建数据表", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "数据表名称", exact: true })
    .fill("项目任务");
  await page.getByRole("button", { name: "创建数据表", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "表格视图", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "添加记录", exact: true })
    .first()
    .click();
  await expect(page.getByText("1 条记录", { exact: true })).toBeVisible();
  await page.getByRole("gridcell").first().dblclick();
  await page
    .getByRole("textbox", { name: "文本", exact: true })
    .fill("准备产品演示");
  await page.getByRole("textbox", { name: "文本", exact: true }).press("Enter");
  await expect(page.getByRole("gridcell").first()).toContainText(
    "准备产品演示",
  );
  await page.getByRole("button", { name: "状态列菜单", exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("sheet-column-menu.png"),
  });
  await page.getByRole("menuitem", { name: "编辑列", exact: true }).click();
  await page
    .getByRole("dialog", { name: "字段设置", exact: true })
    .getByLabel("字段类型", { exact: true })
    .click();
  await expect(
    page.getByRole("option", { name: "附件", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("sheet-field-types.png"),
  });
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog", { name: "字段设置", exact: true })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.getByRole("button", { name: "添加视图", exact: true }).click();
  await page.getByRole("menuitem", { name: "看板视图", exact: true }).click();
  await expect(page.locator(".sheet-board")).toBeVisible();
  await expect(
    page.locator(".sheet-board").getByRole("article").filter({ hasText: "准备产品演示" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "表格视图", exact: true }).click();
  await expect(page.getByRole("button", { name: "生成表单", exact: true })).toHaveCount(0);
  // Existing published forms stay compatible; their workspace creation entry
  // is deferred, so seed this legacy form through the public application API.
  const documentId = new URL(page.url()).pathname.split("/").at(-1)!;
  const document = await responseData(await request.get(workspacePath(session, `/documents/${documentId}`), { headers: sessionHeaders(session) }));
  const currentSheet = await responseData(await request.get(workspacePath(session, `/sheets/${document.sheet_id}`), { headers: sessionHeaders(session) }));
  const legacyForm = await responseData(await request.put(workspacePath(session, `/sheets/${currentSheet.id}/forms`), {
    headers: sessionHeaders(session), data: { id: crypto.randomUUID(), sheet_id: currentSheet.id, version: 0, enabled: true,
      config: { title: "Legacy collection", description: "", fields: currentSheet.definition.fields.map((field: any) => ({ field_id: field.id, required: false, description: "" })) } },
  }));
  const link = new URL("/forms/" + legacyForm.token, page.url()).href;
  const context = await browser.newContext(),
    fill = await context.newPage();
  await fill.goto(link);
  await fill
    .getByRole("textbox", { name: "文本", exact: true })
    .fill("来自公开表单");
  await fill.getByRole("radio", { name: "进行中", exact: true }).check();
  await fill.getByLabel("日期", { exact: true }).fill("2026-10-21");
  await fill.screenshot({
    path: test.info().outputPath("native-public-form.png"),
    animations: "disabled",
  });
  await fill.setViewportSize({ width: 390, height: 844 });
  expect(
    await fill.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await fill.screenshot({
    path: test.info().outputPath("native-public-mobile.png"),
    animations: "disabled",
  });
  let dropped = false;
  await fill.route("**/api/v1/public/forms/*/submissions", async (route) => {
    if (!dropped) {
      dropped = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await fill.getByRole("button", { name: "提交", exact: true }).click();
  await expect(fill.getByRole("alert")).toBeVisible();
  await fill.reload();
  await fill.getByRole("button", { name: "重试提交", exact: true }).click();
  await expect(fill.getByRole("heading", { name: "提交成功" })).toBeVisible();
  await context.close();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "表格视图", exact: true }).click();
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByText("2 条记录", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("gridcell").filter({ hasText: "来自公开表单" }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("sheet-grid.png"),
  });
  expect(errors).toEqual([]);
});

test("public attachment submission is scoped to the collecting form", async ({
  request,
}) => {
  const session = await ownerSession(request),
    collection = await createCollection(
      request,
      session,
      `附件收集 ${Date.now()}`,
    ),
    headers = sessionHeaders(session);
  let sheet = await responseData(
    await request.post(workspacePath(session, "/sheets"), {
      headers,
      data: {
        id: crypto.randomUUID(),
        collection_id: collection.id,
        title: "附件收集",
        template: "",
      },
    }),
  );
  const field = {
    id: crypto.randomUUID(),
    name: "附件",
    kind: "attachment",
    default: null,
    options: [],
  };
  sheet.definition.fields.push(field);
  sheet.definition.views[0].field_ids.push(field.id);
  sheet = await responseData(
    await request.put(workspacePath(session, `/sheets/${sheet.id}`), {
      headers,
      data: {
        version: sheet.version,
        title: sheet.title,
        definition: sheet.definition,
      },
    }),
  );
  const form = await responseData(
    await request.put(workspacePath(session, `/sheets/${sheet.id}/forms`), {
      headers,
      data: {
        id: crypto.randomUUID(),
        sheet_id: sheet.id,
        version: 0,
        enabled: true,
        config: {
          title: "文件收集",
          description: "",
          fields: [{ field_id: field.id, required: true, description: "" }],
        },
      },
    }),
  );
  const publicPath = `/api/v1/public/forms/${form.token}`;
  const file = await responseData(
    await request.post(`${publicPath}/fields/${field.id}/assets`, {
      multipart: {
        file: {
          name: "brief.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Project brief"),
        },
      },
    }),
  );
  const operation = crypto.randomUUID();
  const submission = {
    operation_id: operation,
    version: form.version,
    values: { [field.id]: [file.id] },
  };
  await responseData(
    await request.post(`${publicPath}/submissions`, { data: submission }),
  );
  await responseData(
    await request.post(`${publicPath}/submissions`, { data: submission }),
  );
  const records = await responseData(
    await request.get(workspacePath(session, `/sheets/${sheet.id}/records`), {
      headers,
    }),
  );
  expect(records.items).toHaveLength(1);
  expect(records.items[0].values[field.id]).toEqual([file.id]);
  const forged = await request.post(`${publicPath}/submissions`, {
    data: {
      ...submission,
      operation_id: crypto.randomUUID(),
      values: { [field.id]: [crypto.randomUUID()] },
    },
  });
  expect(forged.status()).toBe(422);
});

test("selection paste, duplicate highlighting, resize and filters operate on stored records", async ({
  page,
  request,
}) => {
  const session = await ownerSession(request),
    collection = await createCollection(
      request,
      session,
      `表格交互 ${Date.now()}`,
    ),
    headers = sessionHeaders(session);
  const sheet = await responseData(
    await request.post(workspacePath(session, "/sheets"), {
      headers,
      data: {
        id: crypto.randomUUID(),
        collection_id: collection.id,
        title: "交互验收",
        template: "",
      },
    }),
  );
  const base = workspacePath(session, `/sheets/${sheet.id}`),
    field = sheet.definition.fields[0];
  await responseData(
    await request.post(`${base}/changes`, {
      headers,
      data: {
        operation_id: crypto.randomUUID(),
        schema_version: 1,
        records: [
          {
            id: crypto.randomUUID(),
            version: 0,
            values: { [field.id]: "原始记录" },
          },
        ],
      },
    }),
  );
  await openWithSession(page, session, `/sheets/${sheet.id}`);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("gridcell").first().dblclick();
  await page
    .getByRole("textbox", { name: "文本", exact: true })
    .fill("将被粘贴替换的草稿");
  await page.evaluate(() =>
    navigator.clipboard.writeText("重复内容\n重复内容"),
  );
  await page.keyboard.press("ControlOrMeta+V");
  await expect(page.getByText("2 条记录", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("gridcell").first()).toContainText("重复内容");
  await page.getByRole("button", { name: "文本列菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "高亮重复值", exact: true }).click();
  await expect(page.locator(".sheet-cell.duplicate")).toHaveCount(2);
  const grid = page.getByRole("grid", { name: "数据表", exact: true });
  const cells = grid.getByRole("gridcell");
  const firstRow = grid.locator(".sheet-grid-row").first();
  const secondRow = grid.locator(".sheet-grid-row").nth(1);
  await firstRow.getByRole("gridcell").last().click();
  await page.keyboard.press("Tab");
  await expect(secondRow.getByRole("gridcell").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Shift+Tab");
  await expect(firstRow.getByRole("gridcell").last()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await cells.first().click();
  await page.keyboard.press("Shift+Tab");
  await expect(grid).not.toBeFocused();
  await cells.last().click();
  await page.keyboard.press("Tab");
  await expect(grid).not.toBeFocused();
  await page.getByRole("button", { name: "文本列菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "文本颜色", exact: true }).click();
  await page.getByRole("menuitem", { name: "蓝色", exact: true }).click();
  await expect(page.getByRole("gridcell").first()).toHaveCSS(
    "color",
    "rgb(38, 117, 190)",
  );
  const resize = page.getByRole("separator", { name: "调整文本列宽" });
  const box = (await resize.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 83, box.y + 20);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const value = await responseData(await request.get(base, { headers }));
      return value.definition.views[0].widths[field.id];
    })
    .toBe(260);
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  const filter = page.getByRole("dialog", { name: "筛选", exact: true });
  await filter.getByRole("button", { name: "添加筛选条件" }).click();
  await filter.getByRole("button", { name: /筛选条件 1$/ }).click();
  await page.getByRole("option", { name: "包含", exact: true }).click();
  await filter
    .getByRole("textbox", { name: "文本", exact: true })
    .fill("不存在");
  await filter.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByText("0 条记录", { exact: true })).toBeVisible();
});

test("document table blocks are created and edited in place without rewriting document content", async ({
  page,
  request,
}) => {
  const session = await ownerSession(request),
    headers = sessionHeaders(session);
  const collection = await createCollection(
    request,
    session,
    `块组件验收 ${Date.now()}`,
  );
  const doc = await responseData(
    await request.post(
      workspacePath(session, `/collections/${collection.id}/documents`),
      { headers, data: { title: "块组件验收" } },
    ),
  );
  const docPath = workspacePath(session, `/documents/${doc.id}`);
  await openWithSession(page, session, `/documents/${doc.id}`);
  await page.getByRole("button", { name: "插入内容", exact: true }).click();
  await page.getByRole("option", { name: "数据表", exact: true }).click();
  const embedded = page.locator(".sheet-embed-editor");
  await expect(
    embedded.getByRole("grid", { name: "数据表", exact: true }),
  ).toBeVisible();
  await embedded
    .getByRole("button", { name: "添加记录", exact: true })
    .first()
    .click();
  await expect(embedded.getByText("1 条记录", { exact: true })).toBeVisible();
  await embedded.getByRole("gridcell").first().dblclick();
  await embedded
    .getByRole("textbox", { name: "文本", exact: true })
    .fill("块内直接输入");
  await embedded
    .getByRole("textbox", { name: "文本", exact: true })
    .press("Enter");
  await expect(embedded.getByRole("gridcell").first()).toContainText(
    "块内直接输入",
  );
  const list = await responseData(
    await request.get(
      workspacePath(session, `/sheets?collection_id=${collection.id}`),
      { headers },
    ),
  );
  expect(list.items).toHaveLength(1);
  const table = list.items[0];
  expect(table.document_id).toBe(doc.id);
  await expect
    .poll(async () =>
      JSON.stringify(
        (
          await responseData(
            await request.get(`${docPath}/content`, { headers }),
          )
        ).blocks,
      ),
    )
    .toContain(table.id);
  const before = await responseData(await request.get(docPath, { headers }));
  await embedded.getByRole("gridcell").first().dblclick();
  await embedded
    .getByRole("textbox", { name: "文本", exact: true })
    .fill("再次编辑已保存");
  await embedded
    .getByRole("textbox", { name: "文本", exact: true })
    .press("Enter");
  await expect(embedded.getByRole("gridcell").first()).toContainText(
    "再次编辑已保存",
  );
  await page.reload();
  await expect(embedded.getByRole("gridcell").first()).toContainText(
    "再次编辑已保存",
  );
  const after = await responseData(await request.get(docPath, { headers }));
  expect(after.content_version).toBe(before.content_version);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("editable-document-table.png"),
    animations: "disabled",
  });
});

test("sheet controls follow the Orbis theme in light and dark appearances", async ({
  page,
  request,
}) => {
  const session = await ownerSession(request),
    collection = await createCollection(
      request,
      session,
      `主题一致性 ${Date.now()}`,
    ),
    headers = sessionHeaders(session);
  const sheet = await responseData(
    await request.post(workspacePath(session, "/sheets"), {
      headers,
      data: {
        id: crypto.randomUUID(),
        collection_id: collection.id,
        title: "项目资料",
        template: "tasks",
      },
    }),
  );
  await openWithSession(page, session, `/sheets/${sheet.id}`);
  for (const mode of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      mode,
    );
    await page.getByRole("button", { name: "状态列菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "编辑列", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "字段设置", exact: true });
    const submit = dialog.getByRole("button", {
      name: "保存字段",
      exact: true,
    });

    // 主操作跟随主题 accent；侧栏新建按钮是独立的中性控件。
    await expect
      .poll(async () => {
        return submit.evaluate((e) => {
          const probe = document.createElement("span");
          probe.style.backgroundColor = "var(--accent)";
          e.appendChild(probe);
          const matches = getComputedStyle(e).backgroundColor === getComputedStyle(probe).backgroundColor;
          probe.remove();
          return matches;
        });
      })
      .toBe(true);
    const field = dialog.getByRole("textbox", {
      name: "字段名称",
      exact: true,
    });
    await expect
      .poll(() =>
        field.evaluate((e) => {
          const p = document.createElement("div");
          p.style.background =
            e.matches(":focus") || e.getAttribute("data-focused") === "true"
              ? "var(--field-focus)"
              : e.matches(":hover") || e.getAttribute("data-hovered") === "true"
                ? "var(--field-hover)"
                : "var(--field-background)";
          document.body.append(p);
          const match =
            getComputedStyle(e).backgroundColor ===
            getComputedStyle(p).backgroundColor;
          p.remove();
          return match;
        }),
      )
      .toBe(true);
    const actual = await field.evaluate((e) => {
      const probe = document.createElement("div");
      probe.style.background =
        e.matches(":focus") || e.getAttribute("data-focused") === "true"
          ? "var(--field-focus)"
          : e.matches(":hover") || e.getAttribute("data-hovered") === "true"
            ? "var(--field-hover)"
            : "var(--field-background)";
      probe.style.borderRadius = "var(--field-radius)";
      document.body.append(probe);
      const expected = getComputedStyle(probe),
        computed = getComputedStyle(e);
      const result = {
        background: computed.backgroundColor,
        expectedBackground: expected.backgroundColor,
        radius: computed.borderRadius,
        expectedRadius: expected.borderRadius,
        font: computed.fontFamily,
      };
      probe.remove();
      return result;
    });
    expect(actual.background).toBe(actual.expectedBackground);
    expect(actual.radius).toBe(actual.expectedRadius);
    expect(actual.font).toContain("Inter Variable");
    await page.screenshot({
      path: test.info().outputPath(`native-field-${mode}.png`),
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await page.screenshot({
      path: test.info().outputPath(`native-grid-${mode}.png`),
      animations: "disabled",
    });
  }
});

test("board loads visible groups without fetching every configured column", async ({
  page,
  request,
}) => {
  const session = await ownerSession(request),
    collection = await createCollection(
      request,
      session,
      `看板性能 ${Date.now()}`,
    ),
    headers = sessionHeaders(session);
  let sheet = await responseData(
    await request.post(workspacePath(session, "/sheets"), {
      headers,
      data: {
        id: crypto.randomUUID(),
        collection_id: collection.id,
        title: "分组看板",
        template: "",
      },
    }),
  );
  const status = sheet.definition.fields[1];
  status.options = Array.from({ length: 40 }, (_, i) => ({
    id: crypto.randomUUID(),
    label: `阶段 ${i + 1}`,
    color: "gray",
  }));
  sheet.definition.views[0].kind = "kanban";
  sheet.definition.views[0].group_field_id = status.id;
  sheet = await responseData(
    await request.put(workspacePath(session, `/sheets/${sheet.id}`), {
      headers,
      data: {
        version: sheet.version,
        title: sheet.title,
        definition: sheet.definition,
      },
    }),
  );
  const groups = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.endsWith(`/sheets/${sheet.id}/records`) &&
      url.searchParams.has("group")
    )
      groups.add(url.searchParams.get("group")!);
  });
  await openWithSession(page, session, `/sheets/${sheet.id}`);
  await expect(page.locator(".sheet-board")).toBeVisible();
  await expect.poll(() => groups.size).toBeGreaterThan(0);
  expect(groups.size).toBeLessThan(10);
  const initial = groups.size;
  await page.locator(".sheet-board").evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect.poll(() => groups.size).toBeGreaterThan(initial);
  expect(groups.size).toBeLessThan(20);
});

test("bounded grid pages retain the reading position when old pages leave the cache", async ({
  page,
  request,
}) => {
  const session = await ownerSession(request),
    collection = await createCollection(
      request,
      session,
      `分页验收 ${Date.now()}`,
    ),
    headers = sessionHeaders(session);
  const sheet = await responseData(
    await request.post(workspacePath(session, "/sheets"), {
      headers,
      data: {
        id: crypto.randomUUID(),
        collection_id: collection.id,
        title: "分页数据",
        template: "",
      },
    }),
  );
  for (let batch = 0; batch < 6; batch++) {
    const count = batch === 5 ? 100 : 200;
    await responseData(
      await request.post(
        workspacePath(session, `/sheets/${sheet.id}/changes`),
        {
          headers,
          data: {
            operation_id: crypto.randomUUID(),
            schema_version: 1,
            records: Array.from({ length: count }, (_, i) => ({
              id: crypto.randomUUID(),
              version: 0,
              values: {
                [sheet.definition.fields[0].id]: `记录 ${batch * 200 + i + 1}`,
              },
            })),
          },
        },
      ),
    );
  }
  await openWithSession(page, session, `/sheets/${sheet.id}`);
  await expect(page.getByText("1100 条记录", { exact: true })).toBeVisible();
  const more = page.getByRole("button", { name: "加载更多记录", exact: true });
  for (let i = 0; i < 9; i++) {
    await more.click();
    await expect(more).toBeEnabled();
  }
  await more.scrollIntoViewIfNeeded();
  const visibleRows = () =>
    page.locator(".sheet-grid-scroll").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll(".sheet-grid-row"))
        .filter((row) => {
          const r = row.getBoundingClientRect();
          return r.top >= rect.top + 40 && r.bottom <= rect.bottom;
        })
        .map((row) => ({
          text: row.querySelector(".sheet-cell")?.textContent ?? "",
          index: row.getAttribute("aria-rowindex"),
        }));
    });
  await expect
    .poll(async () => (await visibleRows()).length)
    .toBeGreaterThan(0);
  const before = await visibleRows();
  await page
    .getByRole("gridcell")
    .filter({ has: page.getByText(before[0].text, { exact: true }) })
    .click();
  await expect(
    page.locator('[role="gridcell"][aria-selected="true"]'),
  ).toHaveCount(1);
  await more.click();
  await expect(page.getByText("1100 条记录", { exact: true })).toBeVisible();
  const retainedCell = page
    .getByRole("gridcell")
    .filter({ has: page.getByText(before[0].text, { exact: true }) });
  await expect(retainedCell).toBeVisible();
  await expect(retainedCell.locator("..")).toHaveAttribute(
    "aria-rowindex",
    before[0].index!,
  );
  await expect(
    page.locator('[role="gridcell"][aria-selected="true"]'),
  ).toHaveCount(0);
  await page.getByRole("grid", { name: "数据表", exact: true }).focus();
  await page.keyboard.press("Delete");
  await expect(retainedCell).toHaveText(before[0].text);
});

test("table pages live in the document tree and edit cells with anchored pickers", async ({
  page,
  request,
}) => {
  const session = await ownerSession(request),
    headers = sessionHeaders(session);
  const collection = await createCollection(
    request,
    session,
    `目录与原位编辑 ${Date.now()}`,
  );
  await openWithSession(page, session, `/collections/${collection.id}`);
  await page.getByRole("button", { name: "创建内容", exact: true }).click();
  await page.getByRole("menuitem", { name: "数据表", exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+$/);
  await expect(
    page
      .locator(".workspace-main-navigation")
      .getByRole("link", { name: "未命名数据表", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "未命名数据表", exact: true }).click();
  await page
    .getByRole("textbox", { name: "数据表名称", exact: true })
    .fill("项目数据");
  await page
    .getByRole("textbox", { name: "数据表名称", exact: true })
    .press("Enter");
  await expect(
    page
      .locator(".workspace-main-navigation")
      .getByRole("link", { name: "项目数据", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "添加记录", exact: true })
    .first()
    .click();
  await expect(page.getByText("1 条记录", { exact: true })).toBeVisible();
  const cells = page.getByRole("gridcell");
  await cells.first().dblclick();
  const input = page.getByRole("textbox", { name: "文本", exact: true });
  await input.fill("原位编辑");
  const cellBox = (await cells.first().boundingBox())!,
    inputBox = (await input.boundingBox())!;
  expect(inputBox.x).toBeGreaterThanOrEqual(cellBox.x);
  expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(
    cellBox.x + cellBox.width,
  );
  expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(
    cellBox.y + cellBox.height,
  );
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("inline-text-editor.png"),
    animations: "disabled",
  });
  await input.press("Tab");
  await page.screenshot({
    path: test.info().outputPath("inline-option-picker.png"),
    animations: "disabled",
  });
  await page.getByRole("option", { name: "进行中", exact: true }).click();
  await expect(cells.nth(1)).toContainText("进行中");
  await cells.nth(1).dblclick();
  await page
    .getByRole("textbox", { name: "搜索状态选项", exact: true })
    .fill("待复核");
  await page
    .getByRole("button", { name: "新建选项「待复核」", exact: true })
    .click();
  await expect(cells.nth(1)).toContainText("待复核");
  await cells.nth(2).dblclick();
  const calendar = page.getByRole("dialog", { name: "日期选择", exact: true });
  await expect(calendar).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("inline-date-picker.png"),
    animations: "disabled",
  });
  await calendar.getByRole("button", { name: "今天", exact: true }).click();
  await expect(cells.nth(2)).not.toBeEmpty();
  await cells.first().dblclick();
  await input.fill("取消的修改");
  await input.press("Escape");
  await expect(cells.first()).toContainText("原位编辑");
  const gutter = page.locator(".sheet-grid-row .sheet-row-label").first();
  expect((await gutter.boundingBox())!.width).toBeGreaterThan(44);
  await gutter.hover();
  await expect(gutter.getByRole("checkbox")).toBeVisible();
  expect((await gutter.getByRole("checkbox").boundingBox())!.width).toBe(14);
  await page.getByRole("button", { name: "查看记录 1", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "记录详情", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  await page.getByRole("button", { name: "收起", exact: true }).click();
  await page.reload();
  await expect(cells.first()).toContainText("原位编辑");
  await expect(cells.nth(1)).toContainText("待复核");
  await page.screenshot({
    path: test.info().outputPath("document-table-inline.png"),
    animations: "disabled",
  });
});

test("inline edits preserve newer typing through a lost save response and retry", async ({
  page,
  request,
}) => {
  const session = await ownerSession(request),
    headers = sessionHeaders(session);
  const collection = await createCollection(
    request,
    session,
    `单元格重试 ${Date.now()}`,
  );
  const sheet = await responseData(
    await request.post(workspacePath(session, "/sheets"), {
      headers,
      data: {
        id: crypto.randomUUID(),
        collection_id: collection.id,
        title: "原位保存重试",
        template: "",
      },
    }),
  );
  const base = workspacePath(session, `/sheets/${sheet.id}`);
  const record = crypto.randomUUID(),
    field = sheet.definition.fields[0].id;
  await responseData(
    await request.post(`${base}/changes`, {
      headers,
      data: {
        operation_id: crypto.randomUUID(),
        schema_version: 1,
        records: [{ id: record, version: 0, values: { [field]: "原值" } }],
      },
    }),
  );
  await openWithSession(page, session, `/documents/${sheet.document_id}`);
  let attempts = 0;
  await page.route(`**/sheets/${sheet.id}/changes`, async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fetch();
      await route.abort("failed");
    } else if (attempts === 2) {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.getByRole("gridcell").first().dblclick();
  const input = page.getByRole("textbox", { name: "文本", exact: true });
  await input.fill("第一次保存");
  await input.press("Enter");
  await expect(page.getByRole("alertdialog", { name: "网络异常，请稍后重试", exact: true })).toBeVisible();
  await input.fill("继续输入的新内容");
  await page.getByRole("button", { name: "本机修改", exact: true }).click();
  const retry = page.getByRole("dialog", { name: "本机修改", exact: true }).getByRole("button", { name: "重试保存", exact: true });
  await retry.click();
  await expect(retry).toHaveCount(0);
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(page.getByRole("gridcell").first()).toContainText(
    "继续输入的新内容",
  );
  await page.reload();
  await expect(page.getByRole("gridcell").first()).toContainText(
    "继续输入的新内容",
  );
  const saved = await responseData(
    await request.get(`${base}/records`, { headers }),
  );
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0].version).toBe(3);
});

test("a typed cell draft survives reload before submission", async ({
  page,
  request,
}) => {
  const session = await ownerSession(request),
    headers = sessionHeaders(session);
  const collection = await createCollection(
    request,
    session,
    `单元格草稿 ${Date.now()}`,
  );
  const sheet = await responseData(
    await request.post(workspacePath(session, "/sheets"), {
      headers,
      data: {
        id: crypto.randomUUID(),
        collection_id: collection.id,
        title: "恢复单元格输入",
        template: "",
      },
    }),
  );
  const base = workspacePath(session, `/sheets/${sheet.id}`),
    record = crypto.randomUUID(),
    field = sheet.definition.fields[0].id;
  await responseData(
    await request.post(`${base}/changes`, {
      headers,
      data: {
        operation_id: crypto.randomUUID(),
        schema_version: 1,
        records: [{ id: record, version: 0, values: { [field]: "原值" } }],
      },
    }),
  );
  await openWithSession(page, session, `/documents/${sheet.document_id}`);
  await page.getByRole("gridcell").first().dblclick();
  const input = page.getByRole("textbox", { name: "文本", exact: true });
  await input.fill("还未提交的输入");
  await page.reload();
  await expect(input).toHaveValue("还未提交的输入");
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  const saved = await responseData(
    await request.get(`${base}/records`, { headers }),
  );
  expect(saved.items[0].values[field]).toBe("还未提交的输入");
  expect(saved.items[0].version).toBe(2);
});
