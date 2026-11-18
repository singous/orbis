import AxeBuilder from "@axe-core/playwright";
import { appendFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

async function mountPanels(page: Page, mode: "library" | "inspector") {
  await page.routeWebSocket(url => url.pathname === "/" && url.searchParams.has("token"), () => {});
  await page.route("**/board-icons/**/index.json", async route => {
    const response = await route.fetch();
    const index = await response.json();
    await route.fulfill({ json: { ...index, count: 8, items: index.items.slice(0, 8) } });
  });
  await page.goto("/__ui");
  await page.evaluate(async mode => {
    const source = await (await fetch("/src/main.tsx")).text();
    const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const root = "/src/features/boards/";
    const [{ default: React }, { default: ReactDOM }, { BoardLibrary }, { BoardInspector }, { BoardShell }, model] = await Promise.all([
      import(reactURL), import(domURL), import(root + "BoardLibrary.tsx"), import(root + "BoardInspector.tsx"), import(root + "BoardShell.tsx"), import(root + "model.ts"), import(root + "boards.css"),
    ]);
    const page = { id: "00000000-0000-4000-8000-000000000001", name: "面板测试画布", background: "#ffffff", position: 0, version: 3 };
    const flow = model.makeElement("flow.process", page.id, 100, 120);
    flow.id = "00000000-0000-4000-8000-000000000002";
    flow.text = "核验资料";
    const connector = model.makeElement("connector", page.id, 0, 0);
    const entity = model.makeElement("er.entity", page.id, 0, 0);
    entity.structure.members = [{ id: "00000000-0000-4000-8000-000000000003", name: "编号", type: "integer", key: "primary" }];
    const elements = new Map([flow, connector, entity].map(element => [element.id, element]));
    const calls: unknown[] = [];
    Object.assign(window, { panelCalls: calls, panelFlow: flow });
    const previous = document.getElementById("root")!;
    previous.hidden = true;
    previous.id = "application-preview-root";
    const host = document.createElement("div");
    host.id = "root";
    document.body.append(host);
    function Panels() {
      const [tab, setTab] = React.useState("shapes");
      const [selected, setSelected] = React.useState("page");
      const [readOnly, setReadOnly] = React.useState(false);
      const selection = new Set(selected === "page" ? [] : [selected === "flow" ? flow.id : selected === "connector" ? connector.id : entity.id]);
      return React.createElement(React.Fragment, null,
        React.createElement("div", { style: { display: "flex", height: 40 } },
          ...["page", "flow", "connector", "entity"].map(value => React.createElement("button", { key: value, type: "button", onClick: () => setSelected(value) }, `选择 ${value}`)),
          React.createElement("button", { type: "button", onClick: () => setReadOnly(value => !value) }, "切换只读")),
        React.createElement("div", { style: { height: 760, display: "flex" } }, React.createElement(BoardShell, { embedded: true, board: { pages: [page] }, status: null, actions: null },
          mode === "library" ? React.createElement(BoardLibrary, { elements, selection, tab, onTab: setTab, readOnly, onShape: (id: string) => calls.push({ shape: id }), onIcon: (id: string) => calls.push({ icon: id }), onTemplate: (template: { id: string }) => calls.push({ template: template.id }), onSelect: (id: string) => calls.push({ selected: id }), onClose: () => calls.push({ close: "library" }) }) : React.createElement(BoardInspector, { elements, selection, page, readOnly, submit: async (commands: unknown) => { calls.push(commands); }, onError: (error: unknown) => calls.push({ error: String(error) }), onClose: () => calls.push({ close: "inspector" }) }))));
    }
    ReactDOM.createRoot(host).render(React.createElement(Panels));
  }, mode);
}

async function evidence(page: Page, state: string, theme: string, width: number) {
  if (!process.env.ORBIS_BOARD_PANEL_EVIDENCE) return;
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {})));
  });
  const values = await page.evaluate(() => {
    const selectors = [".board-library", ".board-inspector", "aside>header", "aside>header strong", "aside>header button", "[data-slot=tabs]", "[data-slot=tabs-list]", "[data-slot=tabs-trigger]", "[data-slot=tabs-content]:not([hidden])", ".board-search", ".board-search svg", ".board-search input", ".board-category", ".board-shape-grid", ".board-shape-grid button", ".board-shape-grid svg", ".board-library-footer", ".board-icon-browser", ".board-icon-row", ".board-icon-row button", ".board-result-count", ".board-template-list", ".board-template-list button", ".board-template-list strong", ".board-template-list small", ".board-template-art", ".board-template-art .board-template-preview", ".board-template-art>span", ".board-object-list", ".board-object-list button", ".board-object-list svg", ".board-object-list span", ".board-inspector-icon", ".board-property-panel fieldset", ".board-property-panel legend", ".board-field", ".board-field>span", ".board-field input", ".board-field [role=combobox]", ".board-property-grid", ".board-check", ".board-inspector-note", ".board-member", ".board-member button", ".board-property-panel fieldset>button"];
    return selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)).slice(0, 6).map((node, index) => {
      const css = getComputedStyle(node), box = node.getBoundingClientRect();
      return { selector, index, tag: node.tagName, x: box.x, y: box.y, width: box.width, height: box.height, display: css.display, position: css.position, flex: css.flex, minWidth: css.minWidth, minHeight: css.minHeight, margin: css.margin, padding: css.padding, gap: css.gap, font: css.font, color: css.color, background: css.backgroundColor, border: css.border, radius: css.borderRadius, shadow: css.boxShadow, textAlign: css.textAlign };
    }));
  });
  appendFileSync(process.env.ORBIS_BOARD_PANEL_EVIDENCE, JSON.stringify({ state, theme, width, values }) + "\n");
  if (process.env.ORBIS_BOARD_PANEL_A11Y) {
    const result = await new AxeBuilder({ page }).include(state.startsWith("library") ? ".board-library" : ".board-inspector").analyze();
    appendFileSync(process.env.ORBIS_BOARD_PANEL_A11Y, JSON.stringify({ state, theme, width, violations: result.violations }) + "\n");
  }
}

async function accessiblePanel(page: Page, selector: string) {
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
}

for (const theme of ["light", "dark"]) for (const width of [1280, 390]) test.describe(`${theme} ${width}px board panels`, () => {
  test.use({ hasTouch: width === 390 });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
    await page.setViewportSize({ width, height: 900 });
  });
  test("library preserves tabs, filters, virtual icons and original insertion payloads", async ({ page }) => {
    await mountPanels(page, "library");
    const library = page.getByRole("complementary", { name: "画板素材" });
    await expect(library).toBeVisible();
    await evidence(page, "library-shapes", theme, width);
    await accessiblePanel(page, ".board-library");
    if (width === 1280) {
      const shapeChoice = library.getByRole("button", { name: "矩形", exact: true });
      await shapeChoice.hover();
      await expect(shapeChoice).toBeEnabled();
      await accessiblePanel(page, ".board-library");
    }
    const search = library.getByRole("textbox", { name: "搜索画板素材" });
    await search.fill("矩形");
    const shape = library.getByRole("button", { name: "矩形", exact: true });
    await shape.click();
    expect(await page.evaluate(() => (window as Window & { panelCalls: unknown[] }).panelCalls)).toEqual([{ shape: "basic.rectangle" }]);
    await library.getByRole("tab", { name: "图形", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    const icons = library.getByRole("tab", { name: "图标", exact: true });
    await expect(icons).toBeFocused();
    await expect(library.locator(".board-icon-row button").first()).toBeVisible();
    await evidence(page, "library-icons", theme, width);
    await page.keyboard.press("ArrowRight");
    await expect(library.getByRole("tab", { name: "模板", exact: true })).toBeFocused();
    await expect(library.locator(".board-template-list button").first()).toBeVisible();
    await evidence(page, "library-templates", theme, width);
    await accessiblePanel(page, ".board-library");
    if (width === 1280) {
      const template = library.locator(".board-template-list button").first();
      await template.hover();
      await expect(template).toBeEnabled();
      await accessiblePanel(page, ".board-library");
    }
    await library.getByRole("tab", { name: "图层", exact: true }).click();
    await expect(library.getByRole("button", { name: "核验资料", exact: true })).toBeVisible();
    await evidence(page, "library-layers", theme, width);
    await library.getByRole("button", { name: "核验资料", exact: true }).click();
    await page.getByRole("button", { name: "切换只读" }).click();
    await library.getByRole("tab", { name: "图形", exact: true }).click();
    await expect(library.getByRole("button", { name: "矩形", exact: true })).toBeDisabled();
  });
  test("inspector preserves page, element and color commit boundaries", async ({ page }) => {
    await mountPanels(page, "inspector");
    const inspector = page.getByRole("complementary", { name: "画板属性" });
    await expect(inspector.getByRole("textbox", { name: "页面名称" })).toHaveValue("面板测试画布");
    await evidence(page, "inspector-page", theme, width);
    await accessiblePanel(page, ".board-inspector");
    await page.getByRole("button", { name: "选择 flow" }).click();
    const text = inspector.getByRole("textbox", { name: "文字", exact: true });
    await evidence(page, "inspector-flow", theme, width);
    await text.fill("核验权限与资料");
    await text.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    expect(await page.evaluate(() => (window as Window & { panelCalls: unknown[] }).panelCalls)).toEqual([]);
    await text.press("Enter");
    const first = await page.evaluate(() => (window as Window & { panelCalls: unknown[][]; panelFlow: { id: string; versions: unknown } }).panelCalls);
    expect(first).toHaveLength(1);
    expect(first[0]).toEqual([{ type: "elements.update", patches: [expect.objectContaining({ id: "00000000-0000-4000-8000-000000000002", text: "核验权限与资料", expected: { geometry: 0, style: 0, text: 0, structure: 0 } })] }]);
    await inspector.getByRole("tab", { name: "样式", exact: true }).click();
    await evidence(page, "inspector-style", theme, width);
    await accessiblePanel(page, ".board-inspector");
    await inspector.getByRole("button", { name: /选择填充颜色/ }).click();
    const picker = page.getByRole("dialog", { name: "选择填充颜色", exact: true });
    const hex = picker.getByRole("textbox", { name: "十六进制颜色", exact: true });
    await hex.fill("123456");
    await hex.press("Enter");
    expect(await page.evaluate(() => (window as Window & { panelCalls: unknown[] }).panelCalls.length)).toBe(2);
    await hex.press("Escape");
    await expect(picker).toHaveCount(0);
    await inspector.getByRole("tab", { name: "属性", exact: true }).click();
    await page.getByRole("button", { name: "选择 connector" }).click();
    await evidence(page, "inspector-connector", theme, width);
    await page.getByRole("button", { name: "选择 entity" }).click();
    await expect(inspector.getByRole("textbox", { name: "字段名称 1", exact: true })).toHaveValue("编号");
    await evidence(page, "inspector-entity", theme, width);
    await page.getByRole("button", { name: "切换只读" }).click();
    await expect(inspector.getByRole("textbox", { name: "文字", exact: true })).toBeDisabled();
    await expect(inspector.getByRole("combobox", { name: "父容器", exact: true })).toBeDisabled();
  });
});

test("board panels retain inclusive container widths and field keyboard focus", async ({ page }) => {
  await mountPanels(page, "inspector");
  const inspector = page.getByRole("complementary", { name: "画板属性" });
  for (const width of [901, 900, 641, 640, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(inspector).toHaveCSS("width", width > 900 ? "352px" : width > 640 ? "288px" : width === 320 ? "240px" : "300px");
    await expect(inspector).toHaveCSS("top", width <= 640 ? "58px" : "12px");
  }
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await inspector.getByRole("button", { name: "关闭属性面板", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(inspector.getByRole("tab", { name: "属性", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(inspector.getByRole("tabpanel", { name: "属性", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  const input = inspector.getByRole("textbox", { name: "页面名称", exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS("outline-style", "solid");
});

test("library retains its narrow container clamp and forced-color tab navigation", async ({ page }) => {
  await mountPanels(page, "library");
  const library = page.getByRole("complementary", { name: "画板素材" });
  for (const width of [641, 640, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(library).toHaveCSS("width", width === 320 ? "240px" : "264px");
  }
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await library.getByRole("button", { name: "收起素材库", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(library.getByRole("tab", { name: "图形", exact: true })).toBeFocused();
  await expect(library.getByRole("tab", { name: "图形", exact: true })).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("End");
  await expect(library.getByRole("tab", { name: "图层", exact: true })).toBeFocused();
  await expect(library.getByRole("button", { name: "核验资料", exact: true })).toBeVisible();
});
