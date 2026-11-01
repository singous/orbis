import type { Page } from "@playwright/test";
import type { TableRecord } from "../../../src/features/data-tables/model";
import { workspace } from "./session";

export const controlId = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
export const tableControlFields = [
  { id: controlId(4), name: "名称", kind: "text", options: [] },
  { id: controlId(5), name: "状态", kind: "select", options: [{ id: controlId(6), label: "待处理", color: "blue" }, { id: controlId(7), label: "已完成", color: "green" }] },
  { id: controlId(8), name: "标签", kind: "multi_select", options: [{ id: controlId(9), label: "标签 A", color: "blue" }, { id: controlId(10), label: "标签 B", color: "green" }] },
];
export const tableControlView = { id: controlId(11), name: "看板视图", kind: "kanban", field_ids: tableControlFields.map(field => field.id), widths: {}, filters: [], sorts: [], group_field_id: controlId(5) };
export const tableControlDefinition = { title: "控件预览", fields: tableControlFields, views: [tableControlView], public_view_id: tableControlView.id, public_field_ids: tableControlFields.map(field => field.id) };

type ControlKind = "dt-multi" | "dt-form-multi" | "dt-board" | "sheet-single" | "sheet-multi" | "sheet-time" | "rating" | "attachment" | "checkbox" | "radio";

export async function mountTableControl(page: Page, kind: ControlKind, localTheme?: "light" | "dark") {
  await page.goto("/__ui");
  await page.evaluate(async ({ kind, fields, view, definition, workspaceId, ids, localTheme }) => {
    const source = await (await fetch("/src/main.tsx")).text();
    const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const [{ default: React }, { default: ReactDOM }, tableCell, board, tableChrome, sheetCell, cell, chrome, dialog] = await Promise.all([import(reactURL), import(domURL), import("/src/features/data-tables/CellEditor.tsx"), import("/src/features/data-tables/TableBoard.tsx"), import("/src/features/data-tables/table-chrome.ts"), import("/src/features/sheets/CellEditor.tsx"), import("/src/features/sheets/Cell.tsx"), import("/src/features/sheets/sheet-chrome.ts"), import("/src/shared/ui/Dialog.tsx"), import("/src/features/data-tables/grid.css")]);
    document.getElementById("root")!.hidden = true;
    const host = document.createElement("div");
    host.dataset.testid = "table-control-preview";
    host.style.padding = "20px";
    if (localTheme) { host.dataset.theme = localTheme; host.style.setProperty("--ob-sheet-blue-base", "#804040"); }
    document.body.append(host);
    const auth = { workspaceId, accessToken: "control-test", refreshToken: null, onTokenRefresh() {}, onUnauthorized() {} };
    const options = [{ id: "a", label: "选项 A", color: "blue" }, { id: "b", label: "选项 B", color: "green" }];
    function Demo() {
      const [value, setValue] = React.useState(kind.startsWith("dt") ? [ids[9]] : kind === "sheet-single" ? "a" : kind === "sheet-time" ? Date.parse("2026-10-09T08:30:00+08:00") : kind === "attachment" ? [ids[15]] : kind === "rating" ? 3 : kind === "checkbox" ? false : kind === "radio" ? "a" : ["a"]);
      const [commits, setCommits] = React.useState([]);
      const [cancels, setCancels] = React.useState(0);
      const [editing, setEditing] = React.useState(true);
      const [selected, setSelected] = React.useState("");
      const [move, setMove] = React.useState([]);
      const outputs = React.createElement(React.Fragment, null,
        React.createElement("output", { "aria-label": "当前值" }, JSON.stringify(value)),
        React.createElement("output", { "aria-label": "提交记录" }, JSON.stringify(commits)),
        React.createElement("output", { "aria-label": "取消次数" }, String(cancels)),
        React.createElement("output", { "aria-label": "打开记录" }, selected),
        React.createElement("output", { "aria-label": "分组变更" }, JSON.stringify(move)));
      const commit = async (next?: unknown, navigation?: string) => {
        if (next !== undefined) setValue(next);
        setCommits((previous: Array<{ value: unknown; navigation?: string }>) => [...previous, { value: next, navigation }]);
        if (kind.startsWith("sheet")) setEditing(false);
        return true;
      };
      if (kind === "dt-board") return React.createElement(React.Fragment, null,
        React.createElement("div", { className: tableChrome.tableSurfaceClassName }, React.createElement(board.TableBoard, { host: { auth, noteId: ids[3], draftScope: "control-browser", readOnly: false, documentVersion: () => 1 }, page: { table_id: ids[12], block_id: ids[13], revision: 1, content_version: 1, definition, view_id: view.id, records: [], total: 101, offset: 0, next_offset: 100, has_more: true, groups: [{ id: ids[6], name: "待处理", count: 101 }, { id: ids[7], name: "已完成", count: 0 }] }, definition, view, onMove: (record: string, group: string | null) => setMove([record, group]), onRecord: (record: TableRecord) => setSelected(record.id) })), outputs);
      if (kind.startsWith("dt")) {
        const editor = React.createElement(tableCell.CellEditor, { field: fields[2], value, readOnly: false, onChange: setValue, onCommit: () => { void commit(); } });
        return React.createElement(React.Fragment, null, kind === "dt-form-multi" ? React.createElement(dialog.Dialog, { open: true, onOpenChange() {} }, React.createElement(dialog.DialogContent, { title: "表格记录" }, React.createElement("div", { className: tableChrome.tableFormClassName }, React.createElement("label", null, "标签", editor)))) : React.createElement("div", { className: tableChrome.tableSurfaceClassName, style: { height: 220 } }, React.createElement("div", { className: "dt-grid-cell", style: { position: "relative", height: 40, width: "100%" } }, editor)), outputs);
      }
      const field = { id: "field", name: kind === "rating" ? "评分" : kind === "attachment" ? "附件" : "字段", kind: kind === "sheet-single" ? "select" : kind === "sheet-multi" ? "multi_select" : kind === "sheet-time" ? "datetime" : kind === "attachment" ? "attachment" : kind === "checkbox" ? "checkbox" : kind === "radio" ? "select" : "rating", options, default: null, include_time: kind === "sheet-time" };
      const content = kind.startsWith("sheet") ? React.createElement("div", { className: "sheet-cell editing", style: { position: "relative", height: 40, width: "min(320px,100%)" } }, editing ? React.createElement(sheetCell.CellEditor, { field, value, auth, onChange: setValue, onCommit: commit, onCancel: () => { setCancels((previous: number) => previous + 1); setEditing(false); } }) : "编辑结束") : React.createElement(cell.ValueEditor, { field, value, auth, publicMode: kind === "radio", onChange: setValue });
      return React.createElement(React.Fragment, null, React.createElement("div", { className: chrome.sheetWorkspaceClassName }, content), outputs);
    }
    ReactDOM.createRoot(host).render(React.createElement(Demo));
  }, { kind, fields: tableControlFields, view: tableControlView, definition: tableControlDefinition, workspaceId: workspace.id, ids: Array.from({ length: 16 }, (_, index) => controlId(index)), localTheme });
}

export async function mountSheetBoardWorkspace(page: Page) {
  await page.goto("/__ui");
  await page.evaluate(async () => {
    const source = await (await fetch("/src/main.tsx")).text();
    const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const sheetSource = await (await fetch("/src/features/sheets/SheetWorkspace.tsx")).text();
    const queryURL = sheetSource.match(/from\s*["']([^"']*@tanstack_react-query[^"']*)["']/)![1];
    const routerURL = sheetSource.match(/from\s*["']([^"']*react-router-dom[^"']*)["']/)![1];
    const [{ default: React }, { default: ReactDOM }, query, router, { SheetWorkspace }, chrome] = await Promise.all([import(reactURL), import(domURL), import(queryURL), import(routerURL), import("/src/features/sheets/SheetWorkspace.tsx"), import("/src/features/workspace/workspace-chrome.ts")]);
    const previous = document.getElementById("root")!;
    previous.hidden = true;
    previous.id = "application-preview-root";
    const host = document.createElement("div");
    host.id = "root";
    host.className = chrome.workspaceShellClassName;
    host.style.padding = "20px";
    document.body.append(host);
    const dataRouter = router.createMemoryRouter([{ path: "/", element: React.createElement(SheetWorkspace, { id: "board-sheet", embedded: true, initialView: "board-view" }) }]);
    ReactDOM.createRoot(host).render(React.createElement(query.QueryClientProvider, { client: new query.QueryClient({ defaultOptions: { queries: { retry: false } } }) }, React.createElement(router.RouterProvider, { router: dataRouter })));
  });
}
