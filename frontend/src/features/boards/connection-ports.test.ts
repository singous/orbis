import { describe, expect, it } from "vitest";
import {
  CONNECTION_SNAP_RADIUS,
  connectionEndpoint,
  connectionPorts,
  findConnectionPort,
} from "./connection-ports";
import { MEMBER_HEADER_HEIGHT, MEMBER_ROW_HEIGHT, portPosition } from "./geometry";
import { makeElement, type Element } from "./model";

function scene(...elements: Element[]) {
  return new Map(elements.map((element) => [element.id, element]));
}

describe("board connection ports", () => {
  it("projects four shape ports through the existing rotated endpoint geometry", () => {
    const node = makeElement("flow.process", crypto.randomUUID(), 20, 40);
    node.geometry = {
      x: 20,
      y: 40,
      width: 160,
      height: 80,
      rotation_rad: Math.PI / 2,
    };
    const ports = connectionPorts(node);
    expect(ports.map((port) => port.port)).toEqual([
      "top",
      "right",
      "bottom",
      "left",
    ]);
    const right = ports.find((port) => port.port === "right")!;
    expect(right.point.x).toBeCloseTo(100);
    expect(right.point.y).toBeCloseTo(160);
    expect(connectionEndpoint(right)).toEqual({
      element_id: node.id,
      port: "right",
      x: right.point.x,
      y: right.point.y,
    });
    expect(connectionPorts(makeElement("connector", node.page_id, 0, 0))).toEqual(
      [],
    );
  });

  it.each(["er.entity", "uml.class"])(
    "keeps %s member ports bound by member identity after reordering",
    (shape) => {
      const node = makeElement(shape, crypto.randomUUID(), 20, 40);
      const first = {
        id: crypto.randomUUID(),
        name: "id",
        type: "uuid",
        key: "" as const,
      };
      const second = {
        id: crypto.randomUUID(),
        name: "name",
        type: "text",
        key: "" as const,
      };
      node.structure.members = [first, second];
      const memberPort = () =>
        connectionPorts(node).find((port) => port.port === `right:${first.id}`)!;
      expect(memberPort().point).toEqual({
        x: node.geometry.x + node.geometry.width,
        y: node.geometry.y + MEMBER_HEADER_HEIGHT + MEMBER_ROW_HEIGHT / 2,
      });
      expect(memberPort().label).toBe("id 右侧连接点");
      node.structure.members = [second, first];
      expect(memberPort().point.y).toBe(
        node.geometry.y + MEMBER_HEADER_HEIGHT + MEMBER_ROW_HEIGHT * 1.5,
      );
    },
  );

  it("offers lifeline points on its timeline and preserves time endpoint semantics", () => {
    const node = makeElement("uml.lifeline", crypto.randomUUID(), 20, 40);
    const ports = connectionPorts(node);
    expect(ports.map((port) => port.port)).toEqual([
      "top",
      "time:0.2",
      "time:0.4",
      "time:0.6",
      "time:0.8",
      "time:1",
    ]);
    for (const port of ports) {
      expect(port.point.x).toBe(node.geometry.x + node.geometry.width / 2);
      expect(port.point).toEqual(portPosition(node, port.port));
    }
  });

  it("keeps snapping distance stable in screen pixels at different zoom levels", () => {
    const node = makeElement("flow.process", crypto.randomUUID(), 100, 100);
    const elements = scene(node);
    const left = portPosition(node, "left");
    for (const zoom of [0.25, 1, 4]) {
      const inside = {
        x: left.x - (CONNECTION_SNAP_RADIUS - 1) / zoom,
        y: left.y,
      };
      const outside = {
        x: left.x - (CONNECTION_SNAP_RADIUS + 1) / zoom,
        y: left.y,
      };
      expect(findConnectionPort(elements, inside, zoom)?.port).toBe("left");
      expect(findConnectionPort(elements, outside, zoom)).toBeNull();
    }
    expect(findConnectionPort(elements, left, 0)).toBeNull();
  });

  it("chooses the nearest visible port, preferring the top object at equal distance", () => {
    const back = makeElement("flow.process", crypto.randomUUID(), 100, 100);
    const front = makeElement("flow.process", back.page_id, 100, 100);
    front.structure.order = 2;
    const point = portPosition(front, "right");
    expect(findConnectionPort(scene(back, front), point, 1)?.elementID).toBe(
      front.id,
    );
    expect(
      findConnectionPort(
        scene(back, front),
        point,
        1,
        undefined,
        new Set([back.id]),
      )?.elementID,
    ).toBe(back.id);
    expect(
      findConnectionPort(scene(back, front), point, 1, undefined, new Set()),
    ).toBeNull();
    front.geometry.x += 3;
    expect(findConnectionPort(scene(back, front), point, 1)?.elementID).toBe(back.id);
  });

  it("ignores the source, other pages, invisible objects and collapsed descendants", () => {
    const source = makeElement("flow.process", crypto.randomUUID(), 100, 100);
    const otherPage = makeElement("flow.process", crypto.randomUUID(), 100, 100);
    const transparent = makeElement("flow.process", source.page_id, 100, 100);
    transparent.style.opacity = 0;
    const parent = makeElement("mindmap.topic", source.page_id, 500, 500);
    parent.structure.collapsed = true;
    const child = makeElement("mindmap.topic", source.page_id, 100, 100);
    child.structure.parent_id = parent.id;
    const grandchild = makeElement("flow.process", source.page_id, 100, 100);
    grandchild.structure.parent_id = child.id;
    const elements = scene(
      source,
      otherPage,
      transparent,
      parent,
      child,
      grandchild,
    );
    expect(
      findConnectionPort(elements, portPosition(source, "top"), 1, source.id),
    ).toBeNull();
    expect(
      findConnectionPort(elements, portPosition(parent, "top"), 1, source.id)
        ?.elementID,
    ).toBe(parent.id);
    parent.structure.collapsed = false;
    expect(
      findConnectionPort(elements, portPosition(grandchild, "top"), 1, source.id),
    ).not.toBeNull();
  });

  it("does not expose endpoints inside malformed cyclic parent relationships", () => {
    const first = makeElement("flow.process", crypto.randomUUID(), 100, 100);
    const second = makeElement("flow.process", first.page_id, 300, 100);
    first.structure.parent_id = second.id;
    second.structure.parent_id = first.id;
    expect(
      findConnectionPort(scene(first, second), portPosition(first, "left"), 1),
    ).toBeNull();
  });
});
