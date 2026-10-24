import { expect, it } from "vitest";
import { makeElement } from "./model";
import { selectedBounds, selectionToolbarPosition } from "./selection-geometry";

it("anchors to the live selection preview without changing the saved element", () => {
  const element = makeElement("flow.process", crypto.randomUUID(), 100, 160);
  const elements = new Map([[element.id, element]]);
  const moved = { ...element, geometry: { ...element.geometry, x: 140, y: 180 } };
  const bounds = selectedBounds(elements, new Set([element.id]), [moved]);
  expect(bounds).toEqual({ x: 140, y: 180, width: 180, height: 80 });
  expect(element.geometry.x).toBe(100);
  expect(selectedBounds(elements, new Set(["missing"]))).toBeNull();
});

it("follows selection movement, camera panning and zoom above the element", () => {
  const bounds = { x: 100, y: 160, width: 180, height: 80 };
  const viewport = { width: 1000, height: 800 };
  const toolbar = { width: 70, height: 42 };
  expect(selectionToolbarPosition(bounds, { x: 80, y: 80, zoom: 1 }, viewport, toolbar)).toEqual({ left: 235, top: 186 });
  expect(selectionToolbarPosition({ ...bounds, x: 140, y: 180 }, { x: 80, y: 80, zoom: 1 }, viewport, toolbar)).toEqual({ left: 275, top: 206 });
  expect(selectionToolbarPosition(bounds, { x: 100, y: 100, zoom: 2 }, viewport, toolbar)).toEqual({ left: 445, top: 366 });
});

it("fits the toolbar inside a small viewport and flips below a selection near the top", () => {
  expect(selectionToolbarPosition({ x: 5, y: 2, width: 20, height: 20 }, { x: 0, y: 0, zoom: 1 }, { width: 320, height: 180 }, { width: 200, height: 42 })).toEqual({ left: 8, top: 34 });
  expect(selectionToolbarPosition({ x: 300, y: 100, width: 20, height: 20 }, { x: 0, y: 0, zoom: 1 }, { width: 320, height: 180 }, { width: 200, height: 42 })).toEqual({ left: 112, top: 46 });
});

it("does not float an action menu over the viewport when its selection is offscreen", () => {
  expect(selectionToolbarPosition({ x: 500, y: 200, width: 100, height: 80 }, { x: 0, y: 0, zoom: 1 }, { width: 320, height: 180 }, { width: 70, height: 42 })).toBeNull();
});
