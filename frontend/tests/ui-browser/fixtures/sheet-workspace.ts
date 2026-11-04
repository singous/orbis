import type { Page } from "@playwright/test";
import { workspace } from "./session";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const fields = [
  { id: "name", name: "名称", kind: "text", options: [], default: null },
  { id: "status", name: "状态", kind: "select", options: [{ id: "todo", label: "待处理", color: "blue" }, { id: "done", label: "已完成", color: "green" }], default: null },
  { id: "number", name: "数量", kind: "number", options: [], default: null },
];
export const initialView = { id: "view-1", name: "全部记录", kind: "grid", field_ids: fields.map(field => field.id), widths: {}, filters: [{ field_id: "name", operator: "contains", value: "示例" }], sorts: [{ field_id: "number", descending: false }], group_field_id: "", row_height: 40, text_colors: {}, highlight_duplicates: [] };
export const initialSheet = { id: "sheet-1", document_id: id(3), workspace_id: workspace.id, collection_id: id(4), title: "产品计划", version: 4, schema_version: 1, data_revision: 1, definition: { fields, views: [initialView] }, created_at_ms: 1, updated_at_ms: 1 };
const notebook = { id: id(4), group_id: id(5), workspace_id: workspace.id, title: "产品笔记本", sort_order: 0, icon: null, metadata_version: 1, directory_version: 1, is_archived: false, archived_at_ms: null, created_at_ms: 1, updated_at_ms: 1 };
export const records = [1, 2].map(value => ({ id: `row-${value}`, version: 2, position: value, values: { name: `示例记录 ${value}`, status: "todo", number: value }, created_at_ms: 1, updated_at_ms: 1, created_by: null, updated_by: null }));

export async function mountWorkspace(page: Page) {
  await page.routeWebSocket(url => url.pathname === "/" && url.searchParams.has("token"), () => {});
  await page.goto("/__ui");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    const source = await (await fetch("/src/main.tsx")).text();
    const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const sheetSource = await (await fetch("/src/features/sheets/SheetWorkspace.tsx")).text();
    const queryURL = sheetSource.match(/from\s*["']([^"']*@tanstack_react-query[^"']*)["']/)![1];
    const routerURL = sheetSource.match(/from\s*["']([^"']*react-router-dom[^"']*)["']/)![1];
    const componentURL = "/src/features/sheets/SheetWorkspace.tsx";
    const chromeURL = "/src/features/workspace/workspace-chrome.ts";
    const [{ default: React }, { default: ReactDOM }, query, router, { SheetWorkspace }, chrome] = await Promise.all([import(reactURL), import(domURL), import(queryURL), import(routerURL), import(componentURL), import(chromeURL)]);
    const previous = document.getElementById("root")!;
    previous.hidden = true;
    previous.id = "application-preview-root";
    const host = document.createElement("div");
    host.id = "root";
    host.className = chrome.workspaceShellClassName;
    host.style.padding = "20px";
    document.body.append(host);
    const dataRouter = router.createMemoryRouter([{ path: "/", element: React.createElement(SheetWorkspace, { id: "sheet-1", embedded: true, initialView: "view-1" }) }]);
    ReactDOM.createRoot(host).render(React.createElement(query.QueryClientProvider, { client: new query.QueryClient({ defaultOptions: { queries: { retry: false } } }) }, React.createElement(router.RouterProvider, { router: dataRouter })));
  });
}

export function sheetReadData(path: string, sheet = initialSheet): unknown {
  if (path.endsWith("/sheets/sheet-1")) return sheet;
  if (path.endsWith("/sheets/sheet-1/records")) return { items: records, next_cursor: "", schema_version: sheet.schema_version, duplicate_ids: {} };
  if (path.endsWith("/sheets/sheet-1/stats")) return { total: 2, groups: [] };
  if (path.endsWith(`/collections/${notebook.id}`)) return notebook;
  return { items: [], pagination: { page: 1, page_size: 20, total: 0 } };
}

export async function sheetHTTP(page: Page) {
  const mutations: string[] = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    if (request.method() !== "GET") mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.fulfill({ json: { code: "OK", message: "", request_id: "sheet-chrome", data: sheetReadData(new URL(request.url()).pathname) } });
  });
  return mutations;
}
