import { describe, expect, it } from "vitest";
import {
  connectorPoints,
  elementBounds,
  elementShapePath,
  portPosition,
  SpatialIndex,
} from "./geometry";
import { makeElement } from "./model";

describe("board geometry", () => {
  it("keeps field-bound connectors attached after field reordering and node movement", () => {
    const page = crypto.randomUUID();
    const entity = makeElement("er.entity", page, 20, 40);
    const a = {
      id: crypto.randomUUID(),
      name: "id",
      type: "uuid",
      key: "primary" as const,
    };
    const b = {
      id: crypto.randomUUID(),
      name: "name",
      type: "text",
      key: "" as const,
    };
    entity.structure.members = [a, b];
    const edge = makeElement("connector", page, 0, 0);
    edge.structure.start = {
      element_id: entity.id,
      port: "right:" + a.id,
      x: 0,
      y: 0,
    };
    edge.structure.end = { element_id: null, port: "", x: 500, y: 200 };
    const scene = new Map([
      [entity.id, entity],
      [edge.id, edge],
    ]);
    const before = connectorPoints(edge, scene)[0];
    entity.structure.members = [b, a];
    entity.geometry.x += 100;
    const after = connectorPoints(edge, scene)[0];
    expect(after.x - before.x).toBe(100);
    expect(after.y - before.y).toBe(24);
  });
  it("finds a connector crossing the viewport even when both endpoints are off screen", () => {
    const edge = makeElement("connector", crypto.randomUUID(), 0, 0);
    edge.structure.start = { element_id: null, port: "", x: -2000, y: 10 };
    edge.structure.end = { element_id: null, port: "", x: 2000, y: 10 };
    const index = new SpatialIndex();
    index.set(edge.id, elementBounds(edge, new Map()));
    expect(index.query({ x: 0, y: 0, width: 800, height: 600 })).toContain(
      edge.id,
    );
  });
  it("handles oversized bounds and removes stale index entries", () => {
    const index = new SpatialIndex();
    index.set("huge", { x: -1e6, y: -1e6, width: 2e6, height: 2e6 });
    index.set("moving", { x: 0, y: 0, width: 10, height: 10 });
    index.set("moving", { x: 5000, y: 5000, width: 10, height: 10 });
    expect(index.query({ x: 0, y: 0, width: 100, height: 100 })).toEqual([
      "huge",
    ]);
    index.delete("huge");
    expect(index.query({ x: 0, y: 0, width: 100, height: 100 })).toEqual([]);
  });
  it("rotates ports around the node center", () => {
    const node = makeElement("flow.process", crypto.randomUUID(), 0, 0);
    node.geometry = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation_rad: Math.PI / 2,
    };
    expect(portPosition(node, "right").x).toBeCloseTo(50);
    expect(portPosition(node, "right").y).toBeCloseTo(100);
  });
  it("attaches mindmap branch sides to their underline while keeping root ports centered", () => {
    const page = crypto.randomUUID();
    for (const shape of ["mindmap.topic", "mindmap.subtopic"]) {
      const node = makeElement(shape, page, 20, 40);
      node.geometry.width = 160;
      node.geometry.height = 40;
      expect(portPosition(node, "left")).toEqual({ x: 20, y: 80 });
      expect(portPosition(node, "right")).toEqual({ x: 180, y: 80 });
      node.geometry.rotation_rad = Math.PI / 2;
      expect(portPosition(node, "right").x).toBeCloseTo(80);
      expect(portPosition(node, "right").y).toBeCloseTo(140);
      expect(elementShapePath(node)).toBe("M0 100H100");
    }
    const root = makeElement("mindmap.root", page, 20, 40);
    expect(portPosition(root, "right").y).toBe(80);
    expect(elementShapePath(root)).toContain("Q");
    expect(elementShapePath(root)).not.toBe(elementShapePath(makeElement("flow.start", page, 20, 40)));
  });
});
