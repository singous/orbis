import type { Page } from "@playwright/test";
import { pagination, user, workspace } from "./session";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const boardId = id(10), documentId = id(11), collectionId = id(12), firstPageId = id(13), secondPageId = id(14);
export const board = { id: boardId, document_id: documentId, workspace_id: workspace.id, collection_id: collectionId, title: "体验设计画板", schema_version: 1, revision: 1, pages: [{ id: firstPageId, name: "主画布", position: 0, background: "#f2f4f7", version: 1 }, { id: secondPageId, name: "评审画布", position: 1, background: "#f2f4f7", version: 1 }], created_at_ms: 1, updated_at_ms: 1 };
const notebook = { id: collectionId, workspace_id: workspace.id, group_id: null, title: "设计手册", sort_order: 0, icon: null, metadata_version: 1, directory_version: 1, is_archived: false, archived_at_ms: null, created_at_ms: 1, updated_at_ms: 1 };
const boardDocument = { id: documentId, workspace_id: workspace.id, collection_id: collectionId, parent_id: null, position: 0, title: board.title, content_version: 1, board_id: boardId, is_archived: false, archived_at_ms: null, created_at_ms: 1, updated_at_ms: 1 };
const element = { id: id(15), page_id: firstPageId, shape_type: "flow.process", shape_version: 1, geometry: { x: 100, y: 100, width: 200, height: 100, rotation_rad: 0 }, style: { fill: "#ffffff", stroke: "#475569", stroke_width: 2, font_size: 16, text_color: "#26354b", opacity: 1, dashed: false, bold: false, align: "center" }, text: "流程步骤", structure: { parent_id: null, order: 0, members: [], start: null, end: null, points: [], route: "straight", start_marker: "none", end_marker: "arrow", icon_id: "", asset_id: null, collapsed: false }, versions: { geometry: 1, style: 1, text: 1, structure: 1 }, version: 1 };

export async function boardHTTP(page: Page, { empty = false } = {}) {
  const mutations: string[] = [];
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") mutations.push(`${request.method()} ${path}`);
    let data: unknown = { items: [], pagination };
    if (path.endsWith(`/boards/${boardId}/preview`)) {
      await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><rect width="600" height="400" fill="#edf3f8"/></svg>' });
      return;
    }
    if (path.endsWith(`/boards/${boardId}`)) data = board;
    else if (path.includes(`/boards/${boardId}/pages/`)) data = { items: path.includes(firstPageId) && !empty ? [element] : [], revision: 1, next_cursor: null, has_more: false };
    else if (path.endsWith(`/boards/${boardId}/changes`)) data = { items: [], revision: 1, has_more: false };
    else if (path.endsWith(`/boards/${boardId}/history`)) data = { items: [{ revision: 1, created_at_ms: 1 }] };
    else if (path.endsWith(`/collections/${collectionId}`)) data = notebook;
    else if (path.endsWith("/collections")) data = { items: [notebook], pagination: { ...pagination, total: 1 } };
    else if (path.endsWith(`/collections/${collectionId}/documents`)) data = { items: [boardDocument], pagination: { ...pagination, total: 1 }, directory_version: 1 };
    else if (path.endsWith(`/documents/${documentId}`)) data = boardDocument;
    else if (path.endsWith("/me")) data = user;
    else if (path.endsWith("/workspaces")) data = { items: [workspace], pagination: { ...pagination, total: 1 } };
    await route.fulfill({ json: { code: "OK", message: "", request_id: "board-chrome", data } });
  });
  await page.routeWebSocket(/\/boards\/.+\/sync/, socket => socket.onMessage(() => socket.send(JSON.stringify({ type: "ready", protocol_version: 1 }))));
  return mutations;
}

export async function mountBoard(page: Page, mode: "editor" | "preview" | "embed" | "embedded-editor") {
  // The isolated production component host must survive unrelated development HMR updates.
  await page.routeWebSocket(url => url.pathname === "/" && url.searchParams.has("token"), () => {});
  await page.goto(`${process.env.ORBIS_BOARD_SOURCE_ORIGIN ?? ""}/__ui`);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async ({ mode, boardId, firstPageId }) => {
    const main = await (await fetch("/src/main.tsx")).text();
    const reactURL = main.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = main.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const app = await (await fetch("/src/app/App.tsx")).text();
    const routerURL = app.match(/from\s*["']([^"']*react-router-dom[^"']*)["']/)![1];
    const queries = await (await fetch("/src/features/documents/queries.ts")).text();
    const queryURL = queries.match(/from\s*["']([^"']*@tanstack_react-query[^"']*)["']/)![1];
    const componentURL = mode === "editor" ? "/src/features/boards/BoardEditor.tsx" : (mode === "embed" || mode === "embedded-editor") ? "/src/features/boards/BoardEmbed.tsx" : "/src/features/boards/BoardView.tsx";
    const [{ default: React }, { default: ReactDOM }, router, query, components] = await Promise.all([import(reactURL), import(domURL), import(routerURL), import(queryURL), import(componentURL)]);
    const previous = document.getElementById("root")!;
    previous.hidden = true;
    previous.id = "application-preview-root";
    const host = document.createElement("div");
    host.id = "root";
    document.body.append(host);
    const content = mode === "editor" ? React.createElement(components.BoardEditor, { id: boardId }) : (mode === "embed" || mode === "embedded-editor") ? React.createElement(components.BoardEmbed, { blockId: mode === "embedded-editor" ? boardId : "", readOnly: mode !== "embedded-editor", props: { board_id: boardId, page_id: firstPageId, mode: mode === "embedded-editor" ? "live" : "snapshot", revision: mode === "embedded-editor" ? null : 1, frame_id: null } }) : React.createElement(components.BoardView, { view: { title: "冻结画板预览", revision: 1, restricted: false, text: "冻结画板", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><rect x="100" y="100" width="300" height="140" rx="8" fill="#edf3f8" stroke="#475569"/><text x="250" y="175" text-anchor="middle" fill="#26354b">冻结画板</text></svg>' } });
    ReactDOM.createRoot(host).render(React.createElement(query.QueryClientProvider, { client: new query.QueryClient({ defaultOptions: { queries: { retry: false } } }) }, React.createElement(router.MemoryRouter, { initialEntries: ["/documents/board-chrome"] }, content)));
  }, { mode, boardId, firstPageId });
}
