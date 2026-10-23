import { describe, expect, it } from "vitest";
import { makeElement } from "./model";
import {
  transformBranch,
  reorderLane,
  removeMember,
  selectionForLayout,
} from "./transforms";
import { reparentElement } from "./mindmap";
describe("diagram structural editing", () => {
  it("retains nested container contents and internal edges in a layout selection", () => {
    const page = crypto.randomUUID(),
      root = makeElement("basic.group", page, 10, 20),
      child = makeElement("basic.group", page, 30, 40),
      grandchild = makeElement("flow.process", page, 50, 60),
      outside = makeElement("flow.process", page, 500, 500),
      edge = makeElement("connector", page, 0, 0);
    child.structure.parent_id = root.id;
    grandchild.structure.parent_id = child.id;
    edge.structure.start = { element_id: child.id, port: "right", x: 0, y: 0 };
    edge.structure.end = {
      element_id: grandchild.id,
      port: "left",
      x: 0,
      y: 0,
    };
    const scene = new Map(
      [root, child, grandchild, outside, edge].map((element) => [
        element.id,
        element,
      ]),
    );
    expect(
      selectionForLayout(scene, new Set([root.id, child.id]))
        .map((element) => element.id)
        .sort(),
    ).toEqual([root.id, child.id, grandchild.id, edge.id].sort());
  });
  it("removes a member while retaining its incident connectors on the entity boundary", () => {
    const page = crypto.randomUUID(),
      entity = makeElement("er.entity", page, 0, 0),
      edge = makeElement("connector", page, 0, 0),
      other = makeElement("connector", page, 0, 0);
    const member = {
      id: crypto.randomUUID(),
      name: "id",
      type: "uuid",
      key: "primary" as const,
    };
    entity.structure.members = [member];
    edge.structure.start = {
      element_id: entity.id,
      port: "right:" + member.id,
      x: 0,
      y: 0,
    };
    edge.structure.end = {
      element_id: entity.id,
      port: "left:" + member.id,
      x: 0,
      y: 0,
    };
    other.structure.start = { element_id: entity.id, port: "top", x: 0, y: 0 };
    const patches = removeMember(
      new Map([entity, edge, other].map((element) => [element.id, element])),
      entity,
      member.id,
    );
    expect(patches).toHaveLength(2);
    expect(patches[0].structure?.members).toEqual([]);
    expect(patches[1].structure?.start).toMatchObject({
      element_id: entity.id,
      port: "right",
    });
    expect(patches[1].structure?.end).toMatchObject({
      element_id: entity.id,
      port: "left",
    });
    expect(patches[1].expected).toEqual(edge.versions);
    expect(entity.structure.members).toEqual([member]);
  });
  it("resizes a container and descendants in one versioned command", () => {
    const page = crypto.randomUUID(),
      root = makeElement("basic.group", page, 0, 0);
    root.geometry.width = 400;
    root.geometry.height = 200;
    const child = makeElement("flow.process", page, 100, 50);
    child.structure.parent_id = root.id;
    child.geometry.width = 100;
    child.geometry.height = 50;
    const scene = new Map([
      [root.id, root],
      [child.id, child],
    ]);
    const patches = transformBranch(scene, root, {
      ...root.geometry,
      width: 800,
      height: 400,
    });
    expect(patches[1].geometry).toMatchObject({
      x: 200,
      y: 100,
      width: 200,
      height: 100,
    });
    expect(patches[1].expected).toEqual(child.versions);
  });
  it("moves lane contents when swapping lanes", () => {
    const page = crypto.randomUUID(),
      a = makeElement("swimlane.horizontal", page, 0, 0),
      b = makeElement("swimlane.horizontal", page, 0, 200),
      child = makeElement("flow.process", page, 80, 40);
    child.structure.parent_id = a.id;
    const patches = reorderLane(
      new Map([
        [a.id, a],
        [b.id, b],
        [child.id, child],
      ]),
      a,
      1,
    );
    expect(patches.find((p) => p.id === child.id)?.geometry?.y).toBe(240);
    expect(patches.find((p) => p.id === b.id)?.geometry?.y).toBe(0);
  });
  it("rebinds the structural mind map connector and rejects parent cycles", () => {
    const page = crypto.randomUUID(),
      a = makeElement("mindmap.root", page, 0, 0),
      b = makeElement("mindmap.topic", page, 200, 0),
      child = makeElement("mindmap.topic", page, 400, 0),
      edge = makeElement("connector", page, 0, 0);
    child.structure.parent_id = a.id;
    edge.structure.start = { element_id: a.id, port: "right", x: 0, y: 0 };
    edge.structure.end = { element_id: child.id, port: "left", x: 0, y: 0 };
    const scene = new Map([a, b, child, edge].map((e) => [e.id, e]));
    const commands = reparentElement(scene, child, b.id);
    expect(commands).toHaveLength(2);
    const update = commands[1];
    if (update.type !== "elements.update") throw Error("expected update");
    expect(update.patches[0].structure?.start?.element_id).toBe(b.id);
    expect(() => reparentElement(scene, a, child.id)).toThrow("子级");
  });
});
