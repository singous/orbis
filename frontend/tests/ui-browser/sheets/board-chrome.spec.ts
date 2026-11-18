import { expect, test } from "@playwright/test";
import { installSession, workspace } from "../fixtures/session";
import { controlId as id, mountSheetBoardWorkspace } from "../fixtures/table-controls";

const fields = [
  { id: "name", name: "名称", kind: "text", options: [], default: null },
  { id: "status", name: "状态", kind: "select", options: [{ id: "todo", label: "待处理", color: "blue" }, { id: "done", label: "已完成", color: "green" }], default: null },
  { id: "number", name: "数量", kind: "number", options: [], default: null },
];
const view = { id: "board-view", name: "看板视图", kind: "kanban", field_ids: fields.map(field => field.id), widths: {}, filters: [], sorts: [], group_field_id: "status", row_height: 40, text_colors: {}, highlight_duplicates: [] };
const initialSheet = { id: "board-sheet", document_id: id(3), workspace_id: workspace.id, collection_id: id(4), title: "看板计划", version: 4, schema_version: 2, data_revision: 1, definition: { fields, views: [view] }, created_at_ms: 1, updated_at_ms: 1 };
const notebook = { id: id(4), group_id: id(5), workspace_id: workspace.id, title: "产品笔记本", sort_order: 0, icon: null, metadata_version: 1, directory_version: 1, is_archived: false, archived_at_ms: null, created_at_ms: 1, updated_at_ms: 1 };
const initialRow = { id: "board-row", version: 3, position: 1, values: { name: "看板记录", status: "todo", number: 1 }, created_at_ms: 1, updated_at_ms: 1, created_by: null, updated_by: null };

for (const theme of ["light", "dark"] as const) for (const width of [1280, 390]) test.describe(`${theme} sheet board ${width}`, () => {
  test.use({ hasTouch: width === 390 });
  test("keeps group paging, observed drag versions, inline edits and empty presentation", async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installSession(page);
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    let sheet = structuredClone(initialSheet), row = structuredClone(initialRow);
    const writes: Array<{ operation_id: string; schema_version: number; records: Array<{ id: string; version: number; values: Record<string, unknown> }> }> = [];
    const reads: URL[] = [], definitions: Array<{ version: number; definition: typeof initialSheet.definition }> = [];
    await page.route("**/api/v1/**", async route => {
      const request = route.request(), url = new URL(request.url());
      let data: unknown = { items: [], pagination: { page: 1, page_size: 20, total: 0 } };
      if (url.pathname.endsWith("/sheets/board-sheet/changes")) {
        const body = request.postDataJSON();
        writes.push(body);
        row = { ...row, version: row.version + 1, values: { ...row.values, ...body.records[0].values } };
        data = { records: [row], deleted: [] };
      } else if (url.pathname.endsWith("/sheets/board-sheet") && request.method() === "PUT") {
        const body = request.postDataJSON();
        definitions.push(body);
        sheet = { ...sheet, ...body, version: sheet.version + 1 };
        data = sheet;
      } else if (url.pathname.endsWith("/sheets/board-sheet")) data = sheet;
      else if (url.pathname.endsWith("/sheets/board-sheet/records")) {
        reads.push(url);
        const group = url.searchParams.get("group"), next = url.searchParams.get("cursor") === "next";
        const items = group === null ? [row] : group === row.values.status ? next ? [{ ...row, id: "next-row", values: { ...row.values, name: "下一页记录" } }] : [row] : [];
        data = { items, next_cursor: group === "todo" && row.values.status === "todo" && !next ? "next" : "", schema_version: 2, duplicate_ids: {} };
      } else if (url.pathname.endsWith("/sheets/board-sheet/stats")) data = { total: 1, groups: [{ value: row.values.status, count: 1 }] };
      else if (url.pathname.endsWith(`/collections/${notebook.id}`)) data = notebook;
      await route.fulfill({ json: { code: "OK", message: "", request_id: "sheet-board-ui", data } });
    });
    await mountSheetBoardWorkspace(page);
    const surface = page.getByRole("region", { name: "看板计划", exact: true });
    await surface.getByRole("button", { name: "全屏展开", exact: true }).click();
    const todo = page.getByRole("region", { name: "待处理", exact: true });
    const done = page.getByRole("region", { name: "已完成", exact: true });
    await expect(todo.locator(".sheet-board-card")).toContainText("看板记录");
    await todo.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(todo.locator(".sheet-board-card")).toContainText("下一页记录");
    expect(reads.some(url => url.searchParams.get("cursor") === "next" && url.searchParams.get("group") === "todo" && url.searchParams.get("view") === "board-view")).toBe(true);
    await todo.getByRole("button", { name: "上一页", exact: true }).click();
    await expect(todo.locator(".sheet-board-card")).toContainText("看板记录");
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await todo.locator(".sheet-board-card").dispatchEvent("dragstart", { dataTransfer: transfer });
    expect(JSON.parse(await transfer.evaluate(value => value.getData("application/orbis-sheet-record")))).toEqual({ sheet: "board-sheet", id: "board-row", version: 3 });
    await done.dispatchEvent("drop", { dataTransfer: transfer });
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ schema_version: 2, records: [{ id: "board-row", version: 3, values: { status: "done" } }] });
    expect(writes[0].operation_id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(done.locator(".sheet-board-card")).toContainText("看板记录");
    await expect(todo.locator(".sheet-board-card")).toHaveCount(0);
    const edit = done.getByRole("button", { name: "编辑名称", exact: true });
    await edit.click();
    const input = done.locator("textarea.sheet-inline-input");
    await expect(input).toBeFocused();
    await input.fill("改名记录");
    await input.press("Enter");
    await expect(input).toHaveCount(0);
    await expect(edit).toBeFocused();
    expect(writes[1]).toMatchObject({ schema_version: 2, records: [{ id: "board-row", version: 4, values: { name: "改名记录" } }] });
    expect(writes[1].operation_id).not.toBe(writes[0].operation_id);
    await expect(done.locator(".sheet-board-card")).toContainText("改名记录");
    await edit.click();
    await done.locator("textarea.sheet-inline-input").fill("取消的名字");
    await page.keyboard.press("Escape");
    await expect(edit).toBeFocused();
    expect(writes).toHaveLength(2);
    await expect(done.locator(".sheet-board-card")).toContainText("改名记录");
    await page.getByRole("button", { name: "分组", exact: true }).click();
    const group = page.getByRole("dialog", { name: "分组", exact: true });
    await group.getByRole("combobox", { name: "按字段分组", exact: true }).click();
    await page.getByRole("option", { name: "不分组", exact: true }).click();
    await group.getByRole("button", { name: "应用", exact: true }).click();
    await expect(group).toHaveCount(0);
    expect(definitions[0]).toMatchObject({ version: 4, definition: { views: [{ group_field_id: "" }] } });
    const empty = page.getByText("选择一个单选字段进行分组，即可开始使用看板。", { exact: true });
    await expect(empty).toBeVisible();
    await expect(empty).toHaveCSS("padding", "64px 32px");
    await expect(empty).toHaveCSS("text-align", "center");
  });
});
