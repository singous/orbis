import { expect, test, type Page } from "@playwright/test";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const fields = [{ id: id(4), name: "名称", kind: "text", options: [] }, { id: id(5), name: "状态", kind: "select", options: [{ id: id(6), label: "待处理", color: "blue" }] }];
const view = { id: id(8), name: "全部记录", kind: "grid", field_ids: fields.map(field => field.id), widths: {}, filters: [{ field_id: id(4), operator: "contains", value: "示例" }], sorts: [], group_field_id: null };
const initialDefinition = { title: "产品计划", fields, views: [view], public_view_id: view.id, public_field_ids: fields.map(field => field.id) };

async function mountTable(page: Page) {
  await page.goto("/__ui");
  await page.evaluate(async ({ definition, ids }) => {
    const source = await (await fetch("/src/main.tsx")).text();
    const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const [{ default: React }, { default: ReactDOM }, { DataTableBlock }, { TableHostContext }, { DataTableSnapshot }] = await Promise.all([import(reactURL), import(domURL), import("/src/features/data-tables/DataTable.tsx"), import("/src/features/data-tables/context.ts"), import("/src/features/data-tables/DataTableSnapshot.tsx")]);
    document.getElementById("root")!.hidden = true;
    const host = document.createElement("div");
    host.dataset.testid = "table-chrome-preview";
    document.body.append(host);
    const root = ReactDOM.createRoot(host);
    let version = 1;
    const tableHost = { noteId: ids[0], draftScope: "chrome-browser", readOnly: false, canRecoverDraft: false, auth: { accessToken: "table-test", refreshToken: null, workspaceId: ids[10], onTokenRefresh() {}, onUnauthorized() {} }, documentVersion: () => version, transact: async (perform: (version: number) => Promise<{ content_version: number }>) => { const result = await perform(version); version = result.content_version; return result; } };
    root.render(React.createElement(TableHostContext.Provider, { value: tableHost }, React.createElement(DataTableBlock, { blockId: ids[3], props: { table_id: ids[2], table_revision: 1 } })));
    host.addEventListener("show-snapshot", () => root.render(React.createElement(DataTableSnapshot, { data: { title: definition.title, view: "公开视图", revision: 1, columns: ["名称", "状态"], rows: Array.from({ length: 101 }, (_, index) => [`公开记录 ${index + 1}`, "待处理"]), total: 101 } })));
  }, { definition: initialDefinition, ids: Array.from({ length: 12 }, (_, index) => id(index)) });
}

for (const theme of ["light", "dark"] as const) for (const width of [1280, 390]) test(`data table ${theme} ${width} preserves settings intent, native menus and snapshot pagination`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  let definition = structuredClone(initialDefinition), version = 1;
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/v1/**", async route => {
    let data: unknown;
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      writes.push(body);
      definition = body.definition ?? definition;
      version++;
      data = { table_id: id(2), block_id: id(3), table_version: version, content_version: version, inverse: null };
    } else data = { table: { table_id: id(2), block_id: id(3), table_version: version, content_version: version, definition }, view_id: view.id, items: [{ id: id(9), values: { [id(4)]: "示例记录", [id(5)]: id(6) } }], groups: [], pagination: { page: 1, page_size: 100, total: 1 } };
    await route.fulfill({ json: { code: "OK", message: "", request_id: "table-chrome-browser", data } });
  });
  await mountTable(page);
  const table = page.locator(".data-table");
  await expect(table.getByRole("grid", { name: "产品计划" })).toBeVisible();
  await expect(table).toHaveCSS("font-size", "13px");
  const settings = table.getByRole("button", { name: "视图设置", exact: true });
  await settings.click();
  const dialog = page.getByRole("dialog", { name: "视图设置", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("视图名称", { exact: true }).fill("未保存视图");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(0);
  await expect(settings).toBeFocused();
  await settings.click();
  await expect(dialog.getByLabel("视图名称", { exact: true })).toHaveValue("全部记录");
  await dialog.getByLabel("视图名称", { exact: true }).fill("项目视图");
  await dialog.getByRole("button", { name: "保存视图", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(table.getByRole("tab", { name: "项目视图", exact: true })).toBeVisible();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ expected_document_version: 1, expected_table_version: 1, definition: { views: [{ ...view, name: "项目视图" }] } });
  expect(writes[0].operation_id).toMatch(/^[0-9a-f-]{36}$/);
  const more = table.getByLabel("更多表格操作", { exact: true });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(table.getByRole("button", { name: "导出 CSV", exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(table.getByRole("button", { name: "导出 CSV", exact: true })).toBeHidden();
  await page.getByTestId("table-chrome-preview").dispatchEvent("show-snapshot");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("cell", { name: "公开记录 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByRole("cell", { name: "公开记录 101", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(page.getByRole("cell", { name: "公开记录 1", exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
});
