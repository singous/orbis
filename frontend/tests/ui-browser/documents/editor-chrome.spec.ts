import { appendFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { installSession } from "../fixtures/session";
import { readContrasts } from "../fixtures/contrast";

async function mountEditor(page: Page, placement: "inline" | "document", loader = false, scope?: { theme: string; foreground: string; surface: string }) {
  await page.routeWebSocket(url => url.pathname === "/" && url.searchParams.has("token"), () => {});
  await page.goto("/login");
  await page.evaluate(async ({ placement, loader, scope }) => {
    const source = await (await fetch("/src/main.tsx")).text();
    const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const app = await (await fetch("/src/app/App.tsx")).text();
    const routerURL = app.match(/from\s*["']([^"']*react-router-dom[^"']*)["']/)![1];
    const queries = await (await fetch("/src/features/documents/queries.ts")).text();
    const queryURL = queries.match(/from\s*["']([^"']*@tanstack_react-query[^"']*)["']/)![1];
    const editorURL = "/src/features/documents/editor/TiptapEditor.tsx";
    const frameURL = "/src/features/documents/editor/EditorToolbarHost.tsx";
    const insertURL = "/src/features/documents/editor/tiptap-insert.ts";
    const layoutURL = "/src/features/documents/editor/EditorLayout.tsx";
    const chromeURL = "/src/features/workspace/workspace-chrome.ts";
    const [{ default: React }, { default: ReactDOM }, router, query, { TiptapEditor }, { EditorToolbarFrame }, { createDocumentBlock }, { EditorLayout, EditorOutlineStore }, chrome, { useElementTheme, OverlayScopeProvider }] = await Promise.all([import(reactURL), import(domURL), import(routerURL), import(queryURL), import(editorURL), import(frameURL), import(insertURL), import(layoutURL), import(chromeURL), import("/packages/ui/src/portal/index.tsx")]);
    const heading = { id: "editor-heading", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "章节标题", styles: {} }], children: [] };
    const paragraph = { id: "editor-paragraph", type: "paragraph", props: {}, content: [{ type: "text", text: "编辑正文", styles: {} }], children: [] };
    const callout = createDocumentBlock("callout");
    callout.props.title = "提示标题";
    const tabs = createDocumentBlock("tabs");
    const code = createDocumentBlock("codeGroup");
    const initial = { schema_version: 2, editor: "blocknote", blocks: [heading, paragraph, callout, tabs, code] };
    document.getElementById("root")!.hidden = true;
    const host = document.createElement("div");
    host.dataset.testid = "editor-preview";
    host.className = placement === "document" ? chrome.workspaceShellClassName + " flex flex-col" : "p-6";
    if (scope) {
      host.dataset.theme = scope.theme;
      host.style.setProperty("--foreground", scope.foreground);
      host.style.setProperty("--popover-foreground", scope.foreground);
      host.style.setProperty("--popover", scope.surface);
    }
    document.body.append(host);
    function Preview() {
      const theme = useElementTheme(host);
      const [blocks, setBlocks] = React.useState(initial);
      const [loads, setLoads] = React.useState(() => new Map(loader ? [[paragraph.id, { id: paragraph.id, parent_id: null, child_count: 2, has_children: true, children_loaded: false, payload_loaded: true, payload_bytes: 16, cursor: null, loaded_count: 0, error: "原始载入错误" }]] : []));
      const [receipt, setReceipt] = React.useState("");
      const [outline] = React.useState(() => { const value = new EditorOutlineStore(); value.update(initial); return value; });
      const editor = React.createElement(TiptapEditor, { blocks, onChange: ({ blocks }: { blocks: typeof initial }) => { setBlocks(blocks); outline.update(blocks); }, noteId: "00000000-0000-4000-8000-000000000020", loadStates: loads, onLoadBlock: async (id: string) => { setReceipt(id); setLoads(new Map()); } });
      const content = React.createElement(EditorLayout, { outlineStore: outline }, editor);
      return React.createElement(OverlayScopeProvider, { value: theme ? { "data-theme": theme.theme, className: theme.theme, style: theme.portalStyle } : undefined },
        placement === "document" ? React.createElement(EditorToolbarFrame, null, content) : content,
        React.createElement("output", { "data-testid": "editor-model", hidden: true }, JSON.stringify(blocks)),
        React.createElement("output", { "data-testid": "loader-receipt", hidden: true }, receipt));
    }
    ReactDOM.createRoot(host).render(React.createElement(query.QueryClientProvider, { client: new query.QueryClient() }, React.createElement(router.MemoryRouter, null, React.createElement(Preview))));
  }, { placement, loader, scope });
  await expect(page.locator(".ProseMirror")).toContainText("编辑正文");
}

for (const theme of ["light", "dark"]) test(`content loader ${theme} retains its widget, error, keyboard focus and editor`, async ({ page }) => {
  await installSession(page);
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  await mountEditor(page, "document", true);
  const editor = page.locator(".ProseMirror");
  const original = await editor.elementHandle();
  const loader = page.locator('.editor-content-loader[data-block-loader="editor-paragraph"]');
  const button = loader.getByRole("button", { name: "载入子内容（2）", exact: true });
  await expect(loader.getByRole("alert")).toHaveText("原始载入错误");
  const [readability] = await readContrasts(page.getByTestId("editor-preview"), [".editor-content-loader-error"]);
  expect(readability.ratio, `${theme} loader error: ${readability.color} on ${readability.background}`).toBeGreaterThanOrEqual(4.5);
  await expect(button).toBeEnabled();
  await editor.focus();
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS("outline-style", "solid");
  expect(await button.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Enter");
  await expect(loader).toHaveCount(0);
  await expect(page.getByTestId("loader-receipt")).toHaveText("editor-paragraph");
  expect(await editor.evaluate((element, previous) => element === previous, original)).toBe(true);
  await expect(editor).toContainText("编辑正文");
});

for (const theme of ["light", "dark"]) test(`native editor portals keep their ${theme} island and drag preview tokens`, async ({ page }) => {
  await installSession(page);
  await page.addInitScript(outer => localStorage.setItem("orbis.appearance", outer), theme === "light" ? "dark" : "light");
  await page.setViewportSize({ width: 390, height: 900 });
  const foreground = theme === "light" ? "#123456" : "#e8f0ff";
  const surface = theme === "light" ? "#edface" : "#263041";
  const foregroundRGB = theme === "light" ? "rgb(18, 52, 86)" : "rgb(232, 240, 255)";
  const surfaceRGB = theme === "light" ? "rgb(237, 250, 206)" : "rgb(38, 48, 65)";
  await mountEditor(page, "document", false, { theme, foreground, surface });
  const toolbar = page.getByRole("toolbar", { name: "文档格式", exact: true });
  await toolbar.getByRole("button", { name: "插入内容", exact: true }).click();
  const insert = page.getByRole("listbox", { name: "插入内容", exact: true });
  await expect(insert).toHaveCSS("background-color", surfaceRGB);
  await expect(insert.getByRole("option", { name: "段落", exact: true })).toHaveCSS("color", foregroundRGB);
  await page.keyboard.press("Escape");
  await toolbar.getByRole("button", { name: "更多格式", exact: true }).click();
  await expect(page.getByRole("menu", { name: "更多格式", exact: true })).toHaveCSS("background-color", surfaceRGB);
  await page.keyboard.press("Escape");
  await page.locator('[data-orbis-block-id="editor-paragraph"]').first().click();
  const grip = page.getByRole("button", { name: "块操作：段落", exact: true });
  await grip.click();
  const menu = page.getByRole("menu", { name: "块操作", exact: true });
  await expect(menu).toHaveCSS("background-color", surfaceRGB);
  await expect(menu.getByRole("menuitem", { name: /复制块/, exact: false }).first()).toHaveCSS("color", foregroundRGB);
  await page.keyboard.press("Escape");
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await grip.dispatchEvent("dragstart", { dataTransfer: transfer });
  const preview = page.locator(".orbis-block-drag-preview");
  await expect(preview).toHaveCSS("background-color", surfaceRGB);
  await expect(preview).toHaveCSS("color", foregroundRGB);
  await grip.dispatchEvent("dragend", { dataTransfer: transfer });
  await expect(preview).toHaveCount(0);
});

for (const theme of ["light", "dark"]) test(`block drag ${theme} keeps its preview, drop marker and real document move`, async ({ page }) => {
  await installSession(page);
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  await mountEditor(page, "inline");
  const paragraph = page.locator('[data-orbis-block-id="editor-paragraph"]').first();
  await paragraph.click();
  const grip = page.getByRole("button", { name: "块操作：段落", exact: true });
  await expect(grip).toBeVisible();
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await grip.dispatchEvent("dragstart", { dataTransfer: transfer });
  const preview = page.locator(".orbis-block-drag-preview");
  await expect(preview).toHaveCSS("position", "fixed");
  await expect(preview).toHaveCSS("width", "300px");
  await expect(preview).toHaveCSS("padding", "12px 16px");
  await expect(preview).toContainText("编辑正文");
  const heading = page.locator('[data-orbis-block-id="editor-heading"]').first();
  const bounds = (await heading.boundingBox())!;
  const event = { dataTransfer: transfer, clientX: bounds.x + 10, clientY: bounds.y + 1 };
  await heading.dispatchEvent("dragover", event);
  const marker = page.locator(".orbis-block-drop");
  await expect(marker).toBeVisible();
  await expect(marker).toHaveCSS("height", "2px");
  expect(await marker.evaluate(element => getComputedStyle(element, "::before").width)).toBe("6px");
  await heading.dispatchEvent("drop", event);
  await expect(preview).toHaveCount(0);
  await expect(marker).toHaveCount(0);
  const model = page.getByTestId("editor-model");
  await expect.poll(async () => JSON.parse(await model.textContent() ?? "{}").blocks[0].id).toBe("editor-paragraph");
  await expect(paragraph).toHaveText("编辑正文");
});

async function recordEditor(page: Page, state: string, theme: string, placement: string, width: number) {
  if (!process.env.ORBIS_EDITOR_EVIDENCE) return;
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {})));
  });
  const values = await page.evaluate(() => {
    const selectors = [".orbis-tiptap-toolbar", ".editor-block-type", ".orbis-tiptap-toolbar button", ".orbis-tiptap-toolbar-divider", ".editor-text-style-tools", ".orbis-tiptap-menu", ".orbis-tiptap-menu button", ".editor-more-menu", ".editor-more-menu button", ".orbis-block-controls", ".block-grip", ".orbis-block-menu", ".block-menu-heading", ".orbis-block-menu button", ".orbis-block-menu kbd", '.orbis-block-menu [data-slot="select-trigger"]', ".block-menu-separator", ".doc-editor-callout", ".doc-editor-settings", ".doc-editor-controls", ".doc-editor-controls label", ".doc-editor-controls button", ".doc-editor-panes", ".doc-editor-panes button", ".orbis-code-toolbar", ".editor-outline-link"];
    return selectors.flatMap(selector => Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(0, 12).map((element, index) => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return { selector, index, x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: style.display, position: style.position, color: style.color, background: style.backgroundColor, border: style.border, radius: style.borderRadius, padding: style.padding, margin: style.margin, gap: style.gap, fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight, shadow: style.boxShadow, overflow: style.overflow };
    }));
  });
  appendFileSync(process.env.ORBIS_EDITOR_EVIDENCE, JSON.stringify({ state, theme, placement, width, values }) + "\n");
}

for (const theme of ["light", "dark"]) for (const placement of ["inline", "document"] as const) for (const width of [1280, 390]) {
  test(`${placement} ${theme} editor at ${width}px preserves formatting and chrome`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await installSession(page);
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.setViewportSize({ width, height: 900 });
    await mountEditor(page, placement);
    const toolbar = page.getByRole("toolbar", { name: "文档格式", exact: true });
    await expect(toolbar).toBeVisible();
    await recordEditor(page, "toolbar", theme, placement, width);
    await toolbar.getByRole("button", { name: "插入内容", exact: true }).click();
    const insert = page.getByRole("listbox", { name: "插入内容", exact: true });
    await expect(insert).toBeVisible();
    await recordEditor(page, "insert", theme, placement, width);
    await page.keyboard.press("Escape");
    await expect(insert).toHaveCount(0);
    if (width === 390) {
      await toolbar.getByRole("button", { name: "更多格式", exact: true }).click();
      const more = page.getByRole("menu", { name: "更多格式", exact: true });
      await expect(more).toBeVisible();
      await recordEditor(page, "more", theme, placement, width);
      await page.keyboard.press("Escape");
      await expect(toolbar.getByRole("button", { name: "更多格式", exact: true })).toBeFocused();
    }
    const paragraph = page.locator('[data-orbis-block-id="editor-paragraph"]').first();
    await paragraph.click();
    await page.keyboard.press("End");
    await toolbar.getByRole("button", { name: "粗体", exact: true }).click();
    await page.keyboard.type("追加");
    await expect(paragraph).toHaveText("编辑正文追加");
    expect(JSON.parse(await page.getByTestId("editor-model").textContent() ?? "{}").blocks[1].content.at(-1).styles.bold).toBe(true);
    await toolbar.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(paragraph).toHaveText("编辑正文");
    await paragraph.click();
    const grip = page.getByRole("button", { name: "块操作：段落", exact: true });
    await expect(grip).toBeVisible();
    await grip.click();
    const menu = page.getByRole("menu", { name: "块操作", exact: true });
    await expect(menu).toBeVisible();
    await recordEditor(page, "block-menu", theme, placement, width);
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: /粘贴块/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".ProseMirror")).toBeFocused();
    const callout = page.locator(".doc-editor-callout");
    await callout.getByRole("button", { name: /^编辑.*属性$/ }).click();
    await expect(callout.locator(".doc-editor-controls")).toBeVisible();
    await recordEditor(page, "properties", theme, placement, width);
    await callout.getByRole("textbox", { name: /标题/ }).fill("保留的属性标题");
    await expect(callout.locator(".doc-editor-title")).toHaveText("保留的属性标题");
    await page.evaluate(async () => {
      const { showToast } = await import("/src/shared/ui/Toast.tsx");
      showToast({ title: "键盘结果反馈", tone: "danger" });
    });
    await page.keyboard.press("F6");
    await expect(page.locator('[data-slot="toast-viewport"]')).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-slot="toast"]')).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-slot="toast-close"]')).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-slot="toast-title"]').filter({ hasText: "键盘结果反馈" })).toBeHidden();
    await expect(callout.getByRole("textbox", { name: /标题/ })).toHaveValue("保留的属性标题");
    await page.locator('.doc-editor-tabs').getByRole("tab").nth(1).click();
    await expect(page.locator('.doc-editor-tabs').getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
    const [readability] = await readContrasts(page.getByTestId("editor-preview"), [".doc-editor-callout > .doc-editor-title"]);
    expect(readability.ratio, `${theme} callout: ${readability.color} on ${readability.background}`).toBeGreaterThanOrEqual(4.5);
    expect(errors).toEqual([]);
  });
}
