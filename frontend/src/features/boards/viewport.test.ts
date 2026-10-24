import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM } from "./renderer";
import { zoomAt } from "./viewport";

describe("board toolbar zoom", () => {
  it("keeps the canvas center on the same world point when zooming in and resetting", () => {
    const camera = { x: -220, y: 75, zoom: 0.5 };
    const anchor = { x: 640, y: 400 };
    const world = { x: (anchor.x - camera.x) / camera.zoom, y: (anchor.y - camera.y) / camera.zoom };
    for (const level of [1.2, 1, 0.25]) {
      const next = zoomAt(camera, level, anchor);
      expect((anchor.x - next.x) / next.zoom).toBeCloseTo(world.x);
      expect((anchor.y - next.y) / next.zoom).toBeCloseTo(world.y);
    }
  });

  it("clamps the requested zoom without moving the anchor", () => {
    const camera = { x: 30, y: -15, zoom: 1 };
    const anchor = { x: 150, y: 100 };
    for (const [level, expected] of [[0, MIN_ZOOM], [MAX_ZOOM * 2, MAX_ZOOM]]) {
      const next = zoomAt(camera, level, anchor);
      expect(next.zoom).toBe(expected);
      expect((anchor.x - next.x) / next.zoom).toBeCloseTo(120);
      expect((anchor.y - next.y) / next.zoom).toBeCloseTo(115);
    }
  });
});
