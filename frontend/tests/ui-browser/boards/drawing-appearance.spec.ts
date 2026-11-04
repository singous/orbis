import { expect, test } from "@playwright/test";
import type { Group } from "konva/lib/Group";
import type { BoardRenderer } from "../../../src/features/boards/renderer";
import type { Element } from "../../../src/features/boards/model";

type DrawingFixture = {
  renderer: { current: BoardRenderer | null };
  elements: Map<string, Element>;
  original: string;
  imageID: string;
  shapeID: string;
  imageNode?: unknown;
  shapeNode?: unknown;
};
declare global { interface Window { drawingFixture: DrawingFixture } }

test("canvas chrome, minimap pixels and icon SVGs follow their actual theme scope without changing authored data", async ({ page }) => {
  await page.routeWebSocket(url => url.pathname === "/" && url.searchParams.has("token"), () => {});
  await page.route("**/board-icons/**/index.json", async route => {
    const response = await route.fetch();
    const index = await response.json();
    await route.fulfill({ json: { ...index, count: 1, items: index.items.slice(0, 1) } });
  });
  await page.goto("/__ui");
  await page.evaluate(async () => {
    const source = await (await fetch("/src/main.tsx")).text();
    const reactURL = source.match(/from\s*["']([^"']*\/react\.js[^"']*)["']/)![1];
    const domURL = source.match(/from\s*["']([^"']*react-dom_client\.js[^"']*)["']/)![1];
    const root = "/src/features/boards/";
    const [{ default: React }, { default: ReactDOM }, { BoardCanvas }, { BoardMinimap }, { BoardLibrary }, model] = await Promise.all([
      import(reactURL), import(domURL), import(root + "BoardCanvas.tsx"), import(root + "BoardMinimap.tsx"), import(root + "BoardLibrary.tsx"), import(root + "model.ts"), import(root + "boards.css"),
    ]);
    const image = model.makeElement("basic.image", "page", 100, 100);
    image.structure.asset_id = crypto.randomUUID();
    const shape = model.makeElement("flow.process", "page", 400, 100);
    shape.style.fill = "#fde047";
    shape.style.text_color = "#881337";
    shape.text = "作者内容";
    const elements = new Map<string, Element>([image, shape].map(element => [element.id, element]));
    const renderer = { current: null };
    window.drawingFixture = { renderer, elements, original: JSON.stringify([...elements.values()]), imageID: image.id, shapeID: shape.id };
    const previous = document.getElementById("root")!;
    previous.hidden = true;
    previous.id = "application-preview-root";
    const host = document.createElement("div");
    document.body.append(host);
    const noop = () => {};
    function Drawing() {
      const [tab, setTab] = React.useState("icons");
      return React.createElement("div", { "data-drawing-scope": "", "data-theme": "light", className: "board-shell", style: { position: "relative", height: 700, width: 1000, "--board-canvas-text": "#1e293b" } },
        React.createElement("div", { className: "board-stage-wrap", style: { position: "relative", width: 1000, height: 600 } }, React.createElement(BoardCanvas, {
          elements, pageID: "page", selection: new Set([image.id]), onSelection: noop, camera: { x: 0, y: 0, zoom: 1 }, onCamera: noop, tool: "select", onTool: noop, submit: async () => {}, readOnly: false, rendererRef: renderer, onError: (error: unknown) => { throw error; }, onUndo: noop, onRedo: noop,
          resolveImage: async () => { throw new Error("图片资源暂不可用"); },
        })),
        React.createElement(BoardMinimap, { elements, camera: { x: 0, y: 0, zoom: 1 }, renderer: null, onCamera: noop }),
        React.createElement(BoardLibrary, { elements, selection: new Set(), tab, onTab: setTab, readOnly: false, onShape: noop, onIcon: noop, onTemplate: noop, onSelect: noop }),
      );
    }
    ReactDOM.createRoot(host).render(React.createElement(Drawing));
  });
  await page.waitForFunction(() => {
    const fixture = window.drawingFixture;
    const image = fixture?.renderer.current?.stage.findOne<Group>("#" + fixture.imageID);
    return image?.findOne(node => node.getAttr("text") === "图片暂时不可用");
  });

  const painted = () => page.evaluate(() => {
    const fixture = window.drawingFixture;
    const stage = fixture.renderer.current!.stage;
    const image = stage.findOne<Group>("#" + fixture.imageID)!;
    const shape = stage.findOne<Group>("#" + fixture.shapeID)!;
    const error = image.findOne(node => node.getAttr("text") === "图片暂时不可用");
    const selection = stage.getLayers()[1].findOne("Rect")!;
    const minimap = document.querySelector<HTMLCanvasElement>(".board-minimap canvas")!;
    const context = minimap.getContext("2d")!;
    const pixels = context.getImageData(0, 0, minimap.width, minimap.height).data;
    const first = pixels.findIndex((value, index) => index % 4 === 3 && value === 255);
    const icon = document.querySelector<HTMLImageElement>(".board-icon-row img");
    return {
      placeholder: image.getChildren()[0].getAttr("fill"),
      error: error?.getAttr("fill"),
      selection: selection.getAttr("stroke"),
      minimap: Array.from(pixels.slice(first - 3, first + 1)),
      icon: icon ? decodeURIComponent(icon.src.split(",")[1]).match(/color="([^"]+)"/)?.[1] : null,
      sameShape: !fixture.shapeNode || fixture.shapeNode === shape,
      sameImage: !fixture.imageNode || fixture.imageNode === image,
      data: JSON.stringify([...fixture.elements.values()]) === fixture.original,
      authoredFill: shape.getChildren()[0].getAttr("fill"),
      authoredText: shape.findOne("Text")?.getAttr("fill"),
    };
  });
  await expect.poll(painted).toMatchObject({ placeholder: "#e2e8f0", error: "#475569", selection: "#2563eb", minimap: [217, 223, 231, 255], icon: "#475569", authoredFill: "#fde047", authoredText: "#881337", data: true });
  const defaults = await painted();
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  };
  const foreground = luminance(defaults.error), background = luminance(defaults.placeholder);
  expect((Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)).toBeGreaterThanOrEqual(4.5);
  await page.evaluate(() => {
    const fixture = window.drawingFixture;
    fixture.imageNode = fixture.renderer.current!.stage.findOne("#" + fixture.imageID);
    fixture.shapeNode = fixture.renderer.current!.stage.findOne("#" + fixture.shapeID);
  });

  await page.addStyleTag({ content: `
    [data-drawing-scope][data-theme="dark"] {
      --ob-board-image-placeholder: #0a1b2c;
      --ob-board-image-error: #bcddef;
      --ob-board-renderer-selection: #f0abfc;
      --ob-board-minimap-shape: #334455;
    }
    [data-drawing-scope][data-theme="dark"] .board-library { --ob-board-library-icon-preview: #cbd5e1; }
  ` });
  await page.locator("[data-drawing-scope]").evaluate(node => { node.setAttribute("data-theme", "dark"); });
  await expect.poll(painted).toMatchObject({ placeholder: "#0a1b2c", error: "#bcddef", selection: "#f0abfc", minimap: [51, 68, 85, 255], icon: "#cbd5e1", sameShape: true, sameImage: false, data: true });

  await page.evaluate(() => {
    const fixture = window.drawingFixture;
    fixture.imageNode = fixture.renderer.current!.stage.findOne("#" + fixture.imageID);
    document.querySelector<HTMLElement>("[data-drawing-scope]")!.style.setProperty("--ob-board-renderer-selection", "#123456");
    document.querySelector<HTMLElement>(".board-library")!.style.setProperty("--ob-board-library-icon-preview", "#abcdef");
  });
  await expect.poll(painted).toMatchObject({ selection: "#123456", icon: "#abcdef", sameShape: true, sameImage: true, data: true });
});
