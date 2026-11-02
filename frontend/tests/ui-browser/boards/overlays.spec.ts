import { appendFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

async function mountOverlays(page: Page, theme: string) {
  await page.addInitScript(theme => localStorage.setItem("orbis.appearance", theme), theme);
  await page.routeWebSocket(url => url.pathname === "/" && url.searchParams.has("token"), () => {});
  await page.goto("/__ui");
  await page.evaluate(async () => {
    const main = await (await fetch("/src/main.tsx")).text();
    const reactURL = main.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = main.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const [{ default: React }, { default: ReactDOM }, { BoardShell }, { BoardConnectionPorts }, { BoardMindmapControls }, model, mindmap] = await Promise.all([
      import(reactURL), import(domURL), import("/src/features/boards/BoardShell.tsx"), import("/src/features/boards/BoardConnectionPorts.tsx"), import("/src/features/boards/BoardMindmapControls.tsx"), import("/src/features/boards/model.ts"), import("/src/features/boards/mindmap.ts"), import("/src/features/boards/boards.css"),
    ]);
    const previous = document.getElementById("root")!; previous.hidden = true; previous.id = "application-preview-root";
    const host = document.createElement("div"); host.id = "root"; host.style.height = "700px"; document.body.append(host);
    const pageID = "00000000-0000-4000-8000-000000000001";
    const shape = model.makeElement("flow.process", pageID, 100, 100); shape.text = "连接图形";
    const tree = mindmap.createMindmap(pageID, { x: 120, y: 220 });
    const board = { id: pageID, document_id: pageID, collection_id: pageID, workspace_id: pageID, title: "锚定操作", schema_version: 1, revision: 1, created_at_ms: 1, updated_at_ms: 1, pages: [{ id: pageID, name: "画布", position: 0, background: "#f2f4f7", version: 1 }] };
    function Fixture() {
      const viewport = React.useRef(null), [collapsed, setCollapsed] = React.useState(false), [camera, setCamera] = React.useState({ x: 80, y: 100, zoom: 1.25 });
      const root = tree.elements.find((element: { id: string }) => element.id === tree.rootID)!;
      const elements = new Map([shape, ...tree.elements.filter((element: { id: string }) => element.id !== root.id), { ...root, structure: { ...root.structure, collapsed } }].map(element => [element.id, element]));
      const submit = async () => { const output = document.getElementById("overlay-commands")!; output.textContent = String(Number(output.textContent) + 1); };
      return React.createElement(React.Fragment, null,
        React.createElement("button", { onClick: () => setCollapsed(value => !value) }, "切换分支快照"),
        React.createElement("button", { onClick: () => setCamera({ x: 20, y: 30, zoom: 2 }) }, "移动相机"),
        React.createElement("output", { id: "overlay-commands", "aria-label": "已提交命令" }, "0"),
        React.createElement(BoardShell, { board, embedded: true, actions: null, status: null },
          React.createElement("div", { className: "board-stage-wrap", ref: viewport, style: { position: "absolute", inset: 0 } },
            React.createElement(BoardConnectionPorts, { elements, pageID, camera, hoveredID: shape.id, selection: new Set([shape.id]), enabled: true, viewport, renderer: { current: null }, submit, onSelection: () => {}, onTool: () => {}, onError: () => {} }),
            React.createElement(BoardMindmapControls, { elements, camera, selection: new Set([tree.rootID]), readOnly: false, submit, onSelection: () => {}, onError: () => {} }))));
    }
    ReactDOM.createRoot(host).render(React.createElement(Fixture));
  });
}

async function evidence(page: Page, state: string, theme: string, coarse: boolean) {
  if (!process.env.ORBIS_BOARD_OVERLAY_EVIDENCE) return;
  const values = await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {})));
    return Array.from(document.querySelectorAll<HTMLElement>(".board-connection-port,.board-connection-port-mark,.board-mindmap-node-controls,.board-mindmap-controls button")).map((node, index) => {
      const s = getComputedStyle(node), box = node.getBoundingClientRect();
      return { index, kind: node.classList.contains("board-connection-port") ? "port" : node.classList.contains("board-connection-port-mark") ? "mark" : node.classList.contains("board-mindmap-node-controls") ? "node" : node.classList.contains("board-mindmap-add") ? "add" : "toggle", x: box.x, y: box.y, width: box.width, height: box.height, left: s.left, top: s.top, padding: s.padding, gap: s.gap, fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, radius: s.borderRadius, border: s.border, color: s.color, background: s.backgroundColor, shadow: s.boxShadow, outline: s.outline, outlineOffset: s.outlineOffset, transform: s.transform };
    });
  });
  appendFileSync(process.env.ORBIS_BOARD_OVERLAY_EVIDENCE, JSON.stringify({ state, theme, coarse, values }) + "\n");
}

for (const coarse of [false, true]) test.describe(coarse ? "coarse overlays" : "desktop overlays", () => {
  test.use({ hasTouch: coarse });
  for (const theme of ["light", "dark"]) test(`${theme} overlays keep camera anchoring, hit geometry and visual states`, async ({ page }) => {
    await mountOverlays(page, theme);
    const ports = page.locator(".board-connection-port"), toggle = page.getByRole("button", { name: "收起“中心主题”的子主题" }), add = page.getByRole("button", { name: "为“中心主题”添加子主题" });
    await expect(ports).toHaveCount(4);
    await expect(toggle).toBeVisible();
    await expect(ports.first()).toHaveCSS("left", "317.5px");
    await expect(ports.first()).toHaveCSS("top", "225px");
    await expect(ports.first()).toHaveCSS("width", coarse ? "44px" : "28px");
    await expect(ports.first()).toHaveCSS("cursor", "crosshair");
    await expect(add).toHaveCSS("width", coarse ? "44px" : "26px");
    await expect(page.locator(".board-mindmap-node-controls")).toHaveCSS("left", "508px");
    await expect(page.locator(".board-mindmap-node-controls")).toHaveCSS("top", "402.5px");
    await evidence(page, "normal", theme, coarse);
    await ports.first().hover();
    await evidence(page, "port-hover", theme, coarse);
    await page.mouse.move(1100, 850);
    await ports.first().focus(); await page.keyboard.press("ArrowRight");
    await expect(ports.first()).toHaveCSS("outline-style", "solid");
    expect(await ports.first().evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
    await evidence(page, "port-focus", theme, coarse);
    await page.keyboard.press("Space");
    await expect(ports.first()).toHaveAttribute("aria-pressed", "true");
    await evidence(page, "port-active", theme, coarse);
    await page.keyboard.press("Escape");
    await expect(ports.first()).toHaveAttribute("aria-pressed", "false");
    await add.hover(); await evidence(page, "mindmap-hover", theme, coarse);
    await page.mouse.move(1100, 850);
    await add.focus(); await page.keyboard.press("ArrowRight");
    await evidence(page, "mindmap-focus", theme, coarse);
    await page.getByRole("button", { name: "切换分支快照" }).click();
    await expect(page.getByRole("button", { name: "展开“中心主题”的子主题" })).toHaveText("9");
    await evidence(page, "collapsed", theme, coarse);
    await page.getByRole("button", { name: "移动相机" }).click();
    await expect(ports.first()).toHaveCSS("left", "400px");
    await expect(ports.first()).toHaveCSS("top", "230px");
    await expect(page.locator(".board-mindmap-node-controls")).toHaveCSS("left", "688px");
    await expect(page.locator(".board-mindmap-node-controls")).toHaveCSS("top", "514px");
    await evidence(page, "camera-shift", theme, coarse);
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await ports.first().focus(); await page.keyboard.press("ArrowRight");
    await expect(ports.first()).toHaveCSS("outline-style", "solid");
    expect(await ports.first().evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
    await evidence(page, "forced-focus", theme, coarse);
    await add.focus();
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
    await expect(add).toBeFocused();
    await expect(page.getByRole("status", { name: "已提交命令" })).toHaveText("0");
  });
});
