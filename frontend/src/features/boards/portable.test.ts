import { describe, expect, it } from "vitest";
import { parsePortable } from "./portable";
import { cloneElements, TEMPLATES } from "./templates";
import { makeElement, type Board } from "./model";
import { appendTopic, hiddenElements } from "./mindmap";
function fixture() {
  const page = crypto.randomUUID();
  const board: Board = {
    id: crypto.randomUUID(),
    document_id: crypto.randomUUID(),
    collection_id: crypto.randomUUID(),
    workspace_id: crypto.randomUUID(),
    schema_version: 1,
    revision: 1,
    title: "Diagram",
    pages: [
      {
        id: page,
        name: "Page",
        background: "#ffffff",
        position: 0,
        version: 1,
      },
    ],
    created_at_ms: 1,
    updated_at_ms: 1,
  };
  return {
    format: "orbis.board",
    schema_version: 1,
    board,
    elements: [makeElement("flow.process", page, 10, 20)],
    assets: [],
  };
}
describe("portable boards and diagram structures", () => {
  it("rejects missing image bytes, future versions and cross-page references before import", () => {
    const f = fixture();
    f.elements[0].structure.asset_id = crypto.randomUUID();
    expect(() => parsePortable(JSON.stringify(f))).toThrow("图片");
    f.elements[0].structure.asset_id = null;
    f.elements[0].shape_version = 2 as 1;
    expect(() => parsePortable(JSON.stringify(f))).toThrow();
    f.elements[0].shape_version = 1;
    f.elements[0].structure.parent_id = crypto.randomUUID();
    expect(() => parsePortable(JSON.stringify(f))).toThrow("引用");
  });
  it("remaps every ER field port and containment reference in all built-in templates", () => {
    for (const template of TEMPLATES) {
      const page = crypto.randomUUID(),
        elements = template.build(page),
        clones = cloneElements(elements, crypto.randomUUID(), 20, 30);
      const ids = new Set(clones.map((e) => e.id));
      expect(new Set(elements.map((e) => e.id)).size).toBe(elements.length);
      for (const clone of clones) {
        if (clone.structure.parent_id)
          expect(ids.has(clone.structure.parent_id)).toBe(true);
        for (const endpoint of [clone.structure.start, clone.structure.end]) {
          if (endpoint?.element_id) {
            const target = clones.find((e) => e.id === endpoint.element_id)!;
            expect(target).toBeDefined();
            const field = endpoint.port.split(":")[1];
            if (field && !endpoint.port.startsWith("time:"))
              expect(target.structure.members.some((m) => m.id === field)).toBe(
                true,
              );
          }
        }
      }
    }
  });
  it("keeps freehand local coordinates unchanged during duplication", () => {
    const line = makeElement("basic.line", crypto.randomUUID(), 10, 20);
    line.structure.points = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    const copy = cloneElements([line], line.page_id, 40, 40)[0];
    expect(copy.structure.points).toEqual(line.structure.points);
    expect(copy.geometry.x).toBe(50);
  });
  it("adds child and sibling topics and hides collapsed subtrees with their connectors", () => {
    const root = makeElement("mindmap.root", crypto.randomUUID(), 20, 30),
      scene = new Map([[root.id, root]]);
    const first = appendTopic(root, scene, false),
      command = first.commands.at(-1)!;
    if (command.type !== "elements.create") throw Error("create expected");
    for (const e of command.elements) scene.set(e.id, e);
    const sibling = appendTopic(scene.get(first.id)!, scene, true).commands.at(
      -1,
    )!;
    if (sibling.type !== "elements.create") throw Error("create expected");
    expect(sibling.elements[0].structure.parent_id).toBe(root.id);
    root.structure.collapsed = true;
    expect(hiddenElements(scene).size).toBe(2);
  });
});
