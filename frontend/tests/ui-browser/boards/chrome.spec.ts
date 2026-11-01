import AxeBuilder from "@axe-core/playwright";
import { appendFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { installSession, pagination, user, workspace } from "../fixtures/session";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const boardId = id(10), documentId = id(11), collectionId = id(12), firstPageId = id(13), secondPageId = id(14);
const board = { id: boardId, document_id: documentId, workspace_id: workspace.id, collection_id: collectionId, title: "体验设计画板", schema_version: 1, revision: 1, pages: [{ id: firstPageId, name: "主画布", position: 0, background: "#f2f4f7", version: 1 }, { id: secondPageId, name: "评审画布", position: 1, background: "#f2f4f7", version: 1 }], created_at_ms: 1, updated_at_ms: 1 };
const notebook = { id: collectionId, workspace_id: workspace.id, group_id: null, title: "设计手册", sort_order: 0, icon: null, metadata_version: 1, directory_version: 1, is_archived: false, archived_at_ms: null, created_at_ms: 1, updated_at_ms: 1 };
const document = { id: documentId, workspace_id: workspace.id, collection_id: collectionId, parent_id: null, position: 0, title: board.title, content_version: 1, board_id: boardId, is_archived: false, archived_at_ms: null, created_at_ms: 1, updated_at_ms: 1 };
const element = { id: id(15), page_id: firstPageId, shape_type: "flow.process", shape_version: 1, geometry: { x: 100, y: 100, width: 200, height: 100, rotation_rad: 0 }, style: { fill: "#ffffff", stroke: "#475569", stroke_width: 2, font_size: 16, text_color: "#26354b", opacity: 1, dashed: false, bold: false, align: "center" }, text: "流程步骤", structure: { parent_id: null, order: 0, members: [], start: null, end: null, points: [], route: "straight", start_marker: "none", end_marker: "arrow", icon_id: "", asset_id: null, collapsed: false }, versions: { geometry: 1, style: 1, text: 1, structure: 1 }, version: 1 };

async function boardHTTP(page: Page, { empty = false } = {}) {
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
    else if (path.endsWith(`/collections/${collectionId}/documents`)) data = { items: [document], pagination: { ...pagination, total: 1 }, directory_version: 1 };
    else if (path.endsWith(`/documents/${documentId}`)) data = document;
    else if (path.endsWith("/me")) data = user;
    else if (path.endsWith("/workspaces")) data = { items: [workspace], pagination: { ...pagination, total: 1 } };
    await route.fulfill({ json: { code: "OK", message: "", request_id: "board-chrome", data } });
  });
  await page.routeWebSocket(/\/boards\/.+\/sync/, socket => socket.onMessage(() => socket.send(JSON.stringify({ type: "ready", protocol_version: 1 }))));
  return mutations;
}

async function mountBoard(page: Page, mode: "editor" | "preview" | "embed" | "embedded-editor") {
  // The isolated production component host must survive unrelated development HMR updates.
  await page.routeWebSocket(url => url.pathname === "/" && url.searchParams.has("token"), () => {});
  await page.goto(`${process.env.ORBIS_BOARD_SOURCE_ORIGIN ?? ""}/__ui`);
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

async function evidence(page: Page, state: string, theme: string, width: number) {
  if (!process.env.ORBIS_BOARD_EVIDENCE) return;
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {})));
  });
  const values = await page.evaluate(() => {
    const selectors = [".board-shell", ".board-help", ".board-header-actions button", ".board-page-actions button", ".board-page-list-container [role=tab]", ".board-empty", ".board-starter-templates", ".board-starter-templates button", ".board-selection-actions", ".board-tool-hint", ".board-document-heading", ".board-save-state", ".board-header-actions", ".board-workspace", ".board-stage-wrap", ".board-toolbar", ".board-toolbar button", ".board-zoom", ".board-zoom button", ".board-history-controls", ".board-page-list-container", ".board-page-actions", ".board-minimap", ".board-library", ".board-library-tabs", ".board-library-panel", ".board-shape-grid", ".board-shape-grid button", ".board-template-list", ".board-template-list button", ".board-inspector", ".board-inspector header", ".board-inspector-tabs", ".board-property-panel", ".board-field", ".board-field input", ".board-preview-viewport", ".board-preview-pan", ".board-preview-transform", ".board-preview-tools", ".board-preview-tools button", ".board-public-svg", ".board-public-svg > svg", ".board-shortcuts"];
    return selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)).slice(0, 8).map((node, index) => {
      const s = getComputedStyle(node), r = node.getBoundingClientRect();
      return { selector, index, x: r.x, y: r.y, width: r.width, height: r.height, display: s.display, color: s.color, background: s.backgroundColor, border: s.border, radius: s.borderRadius, padding: s.padding, gap: s.gap, fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, shadow: s.boxShadow };
    }));
  });
  appendFileSync(process.env.ORBIS_BOARD_EVIDENCE, JSON.stringify({ state, theme, width, values }) + "\n");
}

async function chromeContrast(page: Page, foregroundSelector: string, backgroundSelector: string) {
  return page.evaluate(({ foregroundSelector, backgroundSelector }) => {
    const foreground = getComputedStyle(document.querySelector(foregroundSelector)!).color;
    const background = getComputedStyle(document.querySelector(backgroundSelector)!).backgroundColor;
    const raster = document.createElement("canvas"); raster.width = raster.height = 1;
    const context = raster.getContext("2d")!;
    const luminance = (color: string) => {
      context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const channels = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const a = luminance(foreground), b = luminance(background);
    return { foreground, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  }, { foregroundSelector, backgroundSelector });
}

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) test.describe(`${theme} ${width}px board`, () => {
  test.use({ hasTouch: width === 390 });
  test("editor chrome keeps panels, page tabs, menus and canvas consumers", async ({ page }) => {
    await installSession(page);
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.setViewportSize({ width, height: 900 });
    const mutations = await boardHTTP(page);
    await mountBoard(page, "editor");
    await expect(page.getByRole("application", { name: "画板编辑区域" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "已保存" })).toBeVisible({ visible: width > 760 });
    await evidence(page, "editor", theme, width);
    await page.getByRole("button", { name: "连接线", exact: true }).click();
    await expect(page.locator(".board-tool-hint")).toBeVisible();
    await evidence(page, "connect-hint", theme, width);
    const hintA11y = await new AxeBuilder({ page }).include(".board-tool-hint").analyze();
    const hintContrast = await chromeContrast(page, ".board-tool-hint", ".board-tool-hint");
    await page.getByRole("button", { name: "选择", exact: true }).click();
    await page.getByRole("button", { name: "切换素材面板" }).click();
    const library = page.getByRole("complementary", { name: "画板素材" });
    await expect(library).toBeVisible();
    await evidence(page, "library-shapes", theme, width);
    await library.getByRole("tab", { name: "模板", exact: true }).click();
    await expect(library.locator(".board-template-list")).toBeVisible();
    await evidence(page, "library-templates", theme, width);
    await library.getByRole("button", { name: "收起素材库" }).click();
    await page.getByRole("button", { name: "画布设置" }).click();
    const inspector = page.getByRole("complementary", { name: "画板属性" });
    await expect(inspector.getByRole("textbox", { name: "页面名称" })).toHaveValue("主画布");
    await evidence(page, "inspector", theme, width);
    await inspector.getByRole("button", { name: "关闭属性面板" }).click();
    const zoom = page.getByRole("button", { name: /缩放比例/ });
    await zoom.click();
    await expect(page.getByRole("menu", { name: "画板缩放比例" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(zoom).toBeFocused();
    await page.getByRole("tab", { name: "评审画布", exact: true }).click();
    await expect(page.getByRole("tab", { name: "评审画布", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "主画布", exact: true }).click();
    await page.getByRole("button", { name: "页面与图层", exact: true }).click();
    await library.getByRole("button", { name: "流程步骤", exact: true }).click();
    await library.getByRole("button", { name: "收起素材库" }).click();
    const selection = page.getByRole("toolbar", { name: "选中对象操作" });
    await expect(selection).toBeVisible();
    await evidence(page, "selection-actions", theme, width);
    await selection.getByRole("button", { name: "复制所选对象" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(selection.getByRole("button", { name: "删除所选对象" })).toBeFocused();
    await page.getByRole("application", { name: "画板编辑区域" }).focus();
    await page.keyboard.press("Escape");
    await expect(selection).toHaveCount(0);
    await page.getByRole("button", { name: "画板快捷键帮助" }).click();
    await expect(page.getByRole("dialog", { name: "画板快捷键" })).toBeVisible();
    await evidence(page, "shortcuts", theme, width);
    await page.keyboard.press("Escape");
    expect(mutations).toEqual([]);
    expect(hintA11y.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.failureSummary) }))).toEqual([]);
    expect(hintContrast.ratio, JSON.stringify(hintContrast)).toBeGreaterThanOrEqual(4.5);
  });



  test("embedded board retains editor identity while entering and leaving reading mode", async ({ page }) => {
    await installSession(page);
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.setViewportSize({ width, height: 900 });
    const mutations = await boardHTTP(page);
    await mountBoard(page, "embedded-editor");
    const canvas = page.getByRole("application", { name: "画板编辑区域" });
    await expect(canvas).toBeVisible();
    const original = await canvas.elementHandle();
    await expect(page.getByRole("toolbar", { name: "画板工具", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "画板小地图，点击定位" })).toBeHidden();
    await evidence(page, "embedded-editing", theme, width);
    await page.getByRole("button", { name: "结束编辑", exact: true }).click();
    await expect(page.getByRole("toolbar", { name: "画板工具", exact: true })).toBeHidden();
    await expect(page.getByRole("toolbar", { name: "画板历史操作", exact: true })).toBeHidden();
    await expect(page.getByRole("tablist", { name: "画板页面", exact: true })).toBeHidden();
    expect(await canvas.evaluate((node, original) => node === original, original)).toBe(true);
    await evidence(page, "embedded-reading", theme, width);
    await page.getByRole("button", { name: "编辑画板", exact: true }).click();
    await expect(page.getByRole("toolbar", { name: "画板工具", exact: true })).toBeVisible();
    expect(await canvas.evaluate((node, original) => node === original, original)).toBe(true);
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.getByRole("button", { name: "切换素材面板", exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    const focused = page.locator(":focus");
    expect(await focused.evaluate(node => node.closest('[aria-label="画板工具"]') !== null)).toBe(true);
    await expect(focused).toHaveCSS("outline-style", "solid");
    expect(mutations).toEqual([]);
  });

  test("empty board chrome retains starter geometry and label contrast", async ({ page }) => {
    await installSession(page);
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.setViewportSize({ width, height: 900 });
    await boardHTTP(page, { empty: true });
    await mountBoard(page, "editor");
    await expect(page.getByText("直接开始创作，或选择一个模板")).toBeVisible();
    await evidence(page, "empty-starters", theme, width);
    // Template SVG colors are authored content; the buttons and their labels own chrome contrast.
    const result = await new AxeBuilder({ page }).include(".board-empty").exclude(".board-template-preview").analyze();
    expect(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.failureSummary) }))).toEqual([]);
    // Axe cannot infer the canvas bitmap background, so validate the default canvas material directly.
    const contrast = await chromeContrast(page, ".board-empty > p", ".board-stage-wrap");
    expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
  });

  test("public preview keeps keyboard zoom, pan, menu focus and expanded identity", async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.setViewportSize({ width, height: 900 });
    await mountBoard(page, "preview");
    const pan = page.getByRole("region", { name: "画板预览，拖动平移，使用缩放工具查看细节" });
    await expect(pan).toBeVisible();
    await evidence(page, "preview", theme, width);
    if (width === 390) {
      const sizes = await page.getByRole("group", { name: "画板预览缩放" }).getByRole("button").evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
      expect(sizes.every(size => size.width >= 44 && size.height >= 44)).toBe(true);
    }
    expect((await new AxeBuilder({ page }).include(".board-preview-viewport").analyze()).violations).toEqual([]);
    await pan.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".board-preview-transform")).toHaveCSS("transform", "matrix(1, 0, 0, 1, -40, 0)");
    await page.keyboard.press("+");
    await expect(page.getByRole("button", { name: "缩放比例 120%" })).toBeVisible();
    await page.keyboard.press("0");
    const zoom = page.getByRole("button", { name: "缩放比例 100%" });
    await zoom.click();
    await expect(page.getByRole("menu", { name: "缩放比例" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(zoom).toBeFocused();
    const original = await pan.elementHandle();
    await page.getByRole("button", { name: "全屏展开" }).click();
    await expect(page.getByRole("button", { name: "返回文档" })).toBeFocused();
    expect(await pan.evaluate((node, original) => node === original, original)).toBe(true);
    await evidence(page, "preview-expanded", theme, width);
    await page.getByRole("button", { name: "返回文档" }).click();
    await expect(page.getByRole("button", { name: "全屏展开" })).toBeFocused();
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.keyboard.press("Tab");
    await expect(pan).toBeFocused();
    await expect(pan).toHaveCSS("outline-style", "solid");
  });
});

for (const theme of ["light", "dark"]) test(`snapshot board reference keeps its accessible source at the inclusive narrow boundary in ${theme}`, async ({ page }) => {
  await installSession(page);
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  const mutations = await boardHTTP(page);
  await mountBoard(page, "embed");
  await expect(page.getByRole("region", { name: "画板预览，拖动平移，使用缩放工具查看细节" })).toBeVisible();
  const source = page.getByRole("link", { name: "打开画板", exact: true });
  await expect(source).toHaveAttribute("href", `/documents/${documentId}?page=${firstPageId}`);
  for (const width of [641, 640, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".board-reference-mode")).toBeVisible({ visible: width > 640 });
    await expect(source.locator("span")).toBeVisible({ visible: width > 640 });
    await expect(source).toBeVisible();
    expect(await source.evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(0);
    expect(await page.locator(".embed-surface").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  expect(mutations).toEqual([]);
});

for (const theme of ["light", "dark"]) for (const failure of [503, 409]) test(`page create and retry retain the original mutation in ${theme} after ${failure}`, async ({ page }) => {
  await installSession(page);
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  await page.setViewportSize({ width: 1280, height: 900 });
  await boardHTTP(page);
  const requests: Array<{ operation_id: string; schema_version: number; commands: Array<{ type: string; page: typeof board.pages[number] }> }> = [];
  await page.route(`**/api/v1/workspaces/${workspace.id}/boards/${boardId}/commands`, async route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers().authorization).toBe("Bearer test-token");
    const input = route.request().postDataJSON();
    requests.push(input);
    if (requests.length === 1) await route.fulfill({ status: failure, json: { code: "BOARD_SAVE_REJECTED", message: "保存暂不可用，请重试", request_id: "board-save-failed", data: null } });
    else await route.fulfill({ json: { code: "OK", message: "", request_id: "board-save-retry", data: { operation_id: input.operation_id, revision: 2, elements: [], deleted: [], pages: [{ ...input.commands[0].page, version: 1 }], deleted_pages: [], updated_at_ms: 2 } } });
  });
  await mountBoard(page, "editor");
  await expect(page.getByRole("application", { name: "画板编辑区域" })).toBeVisible();
  for (const width of [761, 760, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".board-save-state")).toBeVisible({ visible: width > 760 });
    await expect(page.locator(".board-export-trigger > span")).toBeVisible({ visible: width > 760 });
  }
  await page.getByRole("button", { name: "添加画板页面" }).click();
  const status = page.locator(".board-save-state");
  await expect(status).toHaveText(failure === 503 ? "保存失败" : "有修改需要处理");
  await expect(page.getByRole("button", { name: "添加画板页面" })).toBeDisabled();
  expect(requests).toHaveLength(1);
  expect(requests[0].schema_version).toBe(1);
  expect(requests[0].commands).toHaveLength(1);
  expect(requests[0].commands[0]).toMatchObject({ type: "pages.create", page: { name: "页面 3", background: "#f2f4f7", position: 2, version: 0 } });
  await evidence(page, `save-${failure}`, theme, 1280);
  const a11y = await new AxeBuilder({ page }).include(".board-document-heading").include(".board-header-actions").analyze();
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(status).toHaveText("已保存");
  await expect(page.getByRole("tab", { name: "页面 3", exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(a11y.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.failureSummary) }))).toEqual([]);
});
