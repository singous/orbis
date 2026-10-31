import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BoardRenderer } from "./renderer";
import { makeElement } from "./model";

const scene = vi.hoisted(() => ({
  nodes: new Map<string, { attrs: Record<string, unknown>; children: Array<{ attrs: Record<string, unknown> }> }>(),
  frames: new Map<number, FrameRequestCallback>(),
  nextFrame: 0,
}));

// Keep the real renderer and its frame scheduling; replace only the raster backend.
vi.mock("konva", () => {
  class Node {
    children: Node[] = [];
    parent: Node | null = null;
    order = 0;
    constructor(public attrs: Record<string, unknown> = {}) {
      if (attrs.name === "board-element") scene.nodes.set(String(attrs.id), this);
    }
    add(...children: Node[]) { for (const child of children) { child.parent = this; this.children.push(child); } }
    on() {}
    position(value: { x: number; y: number }) { Object.assign(this.attrs, value); }
    offset() {}
    rotation() {}
    scale() {}
    hide() { this.attrs.visible = false; }
    show() { this.attrs.visible = true; }
    width() { return Number(this.attrs.width ?? 800); }
    height() { return Number(this.attrs.height ?? 600); }
    zIndex(value?: number) { if (value !== undefined) this.order = value; return this.order; }
    getCanvas() { return { setPixelRatio() {} }; }
    batchDraw() {}
    draw() {}
    destroyChildren() { for (const child of [...this.children]) child.destroy(); }
    destroy() {
      this.destroyChildren();
      if (this.attrs.name === "board-element") scene.nodes.delete(String(this.attrs.id));
      if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    }
  }
  return { default: { Stage: Node, Layer: Node, Group: Node, Path: Node, Rect: Node, Text: Node, Line: Node } };
});
beforeEach(() => {
  scene.nodes.clear();
  scene.frames.clear();
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = ++scene.nextFrame;
    scene.frames.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => scene.frames.delete(id)));
});
afterEach(() => vi.unstubAllGlobals());
function renderer() {
  const container = document.createElement("div");
  Object.defineProperties(container, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  return new BoardRenderer(container, { down: vi.fn(), move: vi.fn(), up: vi.fn(), doubleClick: vi.fn(), zoom: vi.fn() });
}
function frame() {
  const callbacks = [...scene.frames.values()];
  scene.frames.clear();
  for (const callback of callbacks) callback(0);
}

it("releases its scene without clearing the caller's page snapshot on disposal", () => {
  const page = crypto.randomUUID();
  const first = makeElement("flow.process", page, 10, 20);
  const second = makeElement("flow.process", page, 100, 200);
  const firstSnapshot = new Map([[first.id, first]]);
  const nextSnapshot = new Map([[second.id, second]]);
  const view = renderer();
  view.setElements(firstSnapshot);
  view.setElements(nextSnapshot);
  view.destroy();
  expect(firstSnapshot.get(first.id)).toBe(first);
  expect(nextSnapshot.get(second.id)).toBe(second);
  expect(nextSnapshot.size).toBe(1);
  expect(view.stats().total).toBe(0);
});

it("keeps moved nodes and connectors present between drag events and the next paint", () => {
  const page = crypto.randomUUID();
  const first = makeElement("flow.process", page, 100, 160);
  const second = makeElement("flow.process", page, 420, 160);
  const edge = makeElement("connector", page, 0, 0);
  edge.structure.start = { element_id: first.id, port: "right", x: 0, y: 0 };
  edge.structure.end = { element_id: second.id, port: "left", x: 0, y: 0 };
  const view = renderer();
  const elements = new Map([first, second, edge].map(element => [element.id, element]));
  view.setElements(elements);
  frame();
  expect(scene.nodes.has(first.id)).toBe(true);
  expect(scene.nodes.has(edge.id)).toBe(true);
  for (const x of [140, 240, 2000]) {
    view.setPreview([{ ...first, geometry: { ...first.geometry, x } }]);
    expect(scene.nodes.has(first.id), "drag must not remove a node before its next paint").toBe(true);
    expect(scene.nodes.has(edge.id), "connected edges must not blink between paints").toBe(true);
    frame();
    expect(scene.nodes.get(first.id)?.children[0].attrs.opacity).toBe(first.style.opacity);
  }
  view.clearPreview();
  expect(scene.nodes.has(first.id)).toBe(true);
  frame();
  expect(scene.nodes.has(first.id)).toBe(true);
  view.destroy();
});

it("adapts default text on the canvas while preserving filled shapes, custom text colors and source data", () => {
  const page = crypto.randomUUID();
  const box = makeElement("flow.process", page, 100, 160);
  const text = makeElement("basic.text", page, 100, 260);
  const edge = makeElement("connector", page, 0, 0);
  edge.text = "默认连线文字";
  const custom = makeElement("basic.text", page, 100, 360);
  custom.style.text_color = "#e11d48";
  const elements = new Map([box, text, edge, custom].map(element => [element.id, element]));
  const original = JSON.stringify([...elements.values()]);
  const view = renderer();
  view.setElements(elements);
  frame();
  view.setCanvasTextColor("#f8fafc");
  frame();
  for (const element of [text, edge]) expect(scene.nodes.get(element.id)?.children.at(-1)?.attrs.fill).toBe("#f8fafc");
  expect(scene.nodes.get(box.id)?.children.at(-1)?.attrs.fill).toBe(box.style.text_color);
  expect(scene.nodes.get(custom.id)?.children.at(-1)?.attrs.fill).toBe(custom.style.text_color);
  view.setCanvasTextColor("#1e293b");
  frame();
  expect(scene.nodes.get(edge.id)?.children.at(-1)?.attrs.fill).toBe("#1e293b");
  expect(JSON.stringify([...elements.values()])).toBe(original);
  view.destroy();
});

it("keeps a new connector preview visible through background scene updates until its owner clears it", () => {
  const page = crypto.randomUUID();
  const first = makeElement("flow.process", page, 100, 160);
  const second = makeElement("flow.process", page, 420, 160);
  const draft = makeElement("connector", page, 0, 0);
  draft.structure.start = { element_id: first.id, port: "right", x: 280, y: 200 };
  draft.structure.end = { element_id: second.id, port: "left", x: 420, y: 200 };
  const view = renderer();
  view.setElements(new Map([first, second].map(element => [element.id, element])));
  view.setPreview([draft]);
  frame();
  expect(scene.nodes.has(draft.id)).toBe(true);
  view.setElements(new Map([first, { ...second, text: "协作者修改" }].map(element => [element.id, element])));
  frame();
  expect(scene.nodes.has(draft.id)).toBe(true);
  expect(view.stats().total).toBe(2);
  view.clearPreview();
  frame();
  expect(scene.nodes.has(draft.id)).toBe(false);
  expect(view.stats().total).toBe(2);
  view.destroy();
});

it("draws mindmaps as filled root cards and themed text branches with underlines", () => {
  const page = crypto.randomUUID();
  const root = makeElement("mindmap.root", page, 20, 100);
  root.style.fill = "#7162b6";
  root.style.text_color = "#ffffff";
  const branch = makeElement("mindmap.topic", page, 250, 100);
  const custom = makeElement("mindmap.subtopic", page, 500, 100);
  custom.style.fill = "#dbeafe";
  const view = renderer();
  view.setElements(new Map([root, branch, custom].map(node => [node.id, node])));
  view.setCanvasTextColor("#f8fafc");
  frame();
  expect(scene.nodes.get(root.id)?.children[0].attrs).toMatchObject({ fill: "#7162b6", lineJoin: "round" });
  expect(scene.nodes.get(root.id)?.children.at(-1)?.attrs.fill).toBe("#ffffff");
  expect(scene.nodes.get(branch.id)?.children[0].attrs).toMatchObject({
    name: "mindmap-branch-hit-area",
    fill: "transparent",
    width: branch.geometry.width,
    height: branch.geometry.height,
  });
  expect(scene.nodes.get(branch.id)?.children[0].attrs.listening).not.toBe(false);
  expect(scene.nodes.get(branch.id)?.children[1].attrs).toMatchObject({ data: "M0 100H100", fill: undefined });
  expect(scene.nodes.get(branch.id)?.children.at(-1)?.attrs.fill).toBe("#f8fafc");
  expect(scene.nodes.get(custom.id)?.children[0].attrs).toMatchObject({ fill: "#dbeafe", cornerRadius: 6 });
  expect(scene.nodes.get(custom.id)?.children[1].attrs.data).toBe("M0 100H100");
  expect(branch.style.fill).toBe("#ffffff");
  view.destroy();
});
