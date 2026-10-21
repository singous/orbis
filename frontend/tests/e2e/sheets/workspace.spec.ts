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
      `多维表格 ${Date.now()}`,
    );
  await openWithSession(page, session, `/sheets?collection=${collection.id}`);
  await page
    .getByRole("button", { name: "新建数据表", exact: true })
    .first()
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
  await page
    .locator(".sheet-cell-editor")
    .getByRole("button", { name: "保存", exact: true })
    .click();
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
    page.getByRole("button", { name: /准备产品演示/ }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "表格视图", exact: true }).click();
  await page.getByRole("button", { name: "生成表单", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "预览表单", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("sheet-form-editor.png"),
  });
  await page.getByRole("button", { name: "开始收集", exact: true }).click();
  const link = await page
    .getByRole("textbox", { name: "填写链接", exact: true })
    .inputValue();
  await expect(page.getByRole("img", { name: "表单填写二维码" })).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: test.info().outputPath("sheet-form-sharing.png"),
  });
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
  await page.getByRole("gridcell").first().click();
  await page.evaluate(() =>
    navigator.clipboard.writeText("重复内容\n重复内容"),
  );
  await page.keyboard.press("Control+V");
  await expect(page.getByText("2 条记录", { exact: true })).toBeVisible();
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

test("document embeds reference independent data without changing document versions", async ({
  page,
  request,
}) => {
  const session = await ownerSession(request),
    collection = await createCollection(
      request,
      session,
      `文档引用 ${Date.now()}`,
    ),
    headers = sessionHeaders(session);
  const sheet = await responseData(
    await request.post(workspacePath(session, "/sheets"), {
      headers,
      data: {
        id: crypto.randomUUID(),
        collection_id: collection.id,
        title: "独立数据源",
        template: "",
      },
    }),
  );
  const field = sheet.definition.fields[0].id,
    record = crypto.randomUUID();
  const base = workspacePath(session, `/sheets/${sheet.id}`);
  await responseData(
    await request.post(`${base}/changes`, {
      headers,
      data: {
        operation_id: crypto.randomUUID(),
        schema_version: 1,
        records: [{ id: record, version: 0, values: { [field]: "引用前" } }],
      },
    }),
  );
  const doc = await responseData(
    await request.post(
      workspacePath(session, `/collections/${collection.id}/documents`),
      { headers, data: { title: "引用验收" } },
    ),
  );
  const docPath = workspacePath(session, `/documents/${doc.id}`);
  await openWithSession(page, session, `/documents/${doc.id}`);
  await page.getByRole("button", { name: "插入内容", exact: true }).click();
  await page.getByRole("option", { name: "多维表格", exact: true }).click();
  await page
    .getByRole("combobox", { name: "选择数据表" })
    .selectOption(sheet.id);
  await page.getByRole("button", { name: "插入引用", exact: true }).click();
  await expect(
    page.locator(".sheet-embed td").filter({ hasText: "引用前" }),
  ).toBeVisible();
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
    .toContain(sheet.id);
  const before = await responseData(await request.get(docPath, { headers }));
  await responseData(
    await request.post(`${base}/changes`, {
      headers,
      data: {
        operation_id: crypto.randomUUID(),
        schema_version: 1,
        records: [
          { id: record, version: 1, values: { [field]: "独立修改后" } },
        ],
      },
    }),
  );
  await page.reload();
  await expect(
    page.locator(".sheet-embed td").filter({ hasText: "独立修改后" }),
  ).toBeVisible();
  const after = await responseData(await request.get(docPath, { headers }));
  expect(after.content_version).toBe(before.content_version);
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
    const brand = await page
      .getByRole("button", { name: "新建资产", exact: true })
      .evaluate((e) => getComputedStyle(e).backgroundColor);
    await page.getByRole("button", { name: "状态列菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "编辑列", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "字段设置", exact: true });
    const submit = dialog.getByRole("button", {
      name: "保存字段",
      exact: true,
    });

    expect(
      await submit.evaluate((e) => getComputedStyle(e).backgroundColor),
    ).toBe(brand);
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
    .getByRole("gridcell", { name: before[0].text, exact: true })
    .click();
  await expect(
    page.locator('[role="gridcell"][aria-selected="true"]'),
  ).toHaveCount(1);
  await more.click();
  await expect(page.getByText("1100 条记录", { exact: true })).toBeVisible();
  const retainedCell = page.getByRole("gridcell", {
    name: before[0].text,
    exact: true,
  });
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
