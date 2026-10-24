import { expect, it } from "vitest";
import { mindmapLayout } from "./layout";
import { makeElement, type Element } from "./model";

function placed(elements: Element[]) {
  const positions = new Map(mindmapLayout(elements).map(patch => [patch.id, patch.geometry!]));
  return new Map(elements.map(element => [element.id, positions.get(element.id) ?? element.geometry]));
}

it("uses actual parent widths and visible subtree heights while anchoring each root", () => {
  const page = crypto.randomUUID();
  const root = makeElement("mindmap.root", page, 420, 360);
  root.geometry = { ...root.geometry, width: 300, height: 44 };
  const first = makeElement("mindmap.topic", page, 0, 0), second = makeElement("mindmap.topic", page, 0, 0);
  first.structure.parent_id = second.structure.parent_id = root.id;
  first.geometry = { ...first.geometry, width: 250, height: 40 };
  second.geometry.height = 90;
  second.structure.order = 1;
  const child = makeElement("mindmap.subtopic", page, 0, 0);
  child.structure.parent_id = first.id;
  child.geometry.height = 160;
  const other = makeElement("mindmap.root", page, 1600, 1000);
  const before = JSON.stringify([root, first, second, child, other]);
  const positions = placed([root, first, second, child, other]);
  expect(positions.get(root.id)).toMatchObject({ x: 420, y: 360 });
  expect(positions.get(other.id)).toMatchObject({ x: 1600, y: 1000 });
  expect(positions.get(first.id)!.x).toBe(420 + 300 + 64);
  expect(positions.get(child.id)!.x).toBe(420 + 300 + 64 + 250 + 64);
  expect(positions.get(child.id)!.y + 160 + 20).toBeLessThanOrEqual(positions.get(second.id)!.y);
  expect(JSON.stringify([root, first, second, child, other])).toBe(before);
});

it("does not move hidden descendants or let them consume layout space", () => {
  const page = crypto.randomUUID();
  const root = makeElement("mindmap.root", page, 900, 900);
  const branch = makeElement("mindmap.topic", page, 0, 0);
  branch.structure.parent_id = root.id;
  branch.structure.collapsed = true;
  const hidden = makeElement("mindmap.subtopic", page, 700, 710);
  hidden.structure.parent_id = branch.id;
  hidden.geometry.height = 3000;
  const patches = mindmapLayout([root, branch, hidden]);
  expect(patches.some(patch => patch.id === hidden.id)).toBe(false);
  expect(patches.find(patch => patch.id === branch.id)!.geometry!.y).toBe(root.geometry.y);
});

it("rejects parent cycles even when a node is collapsed", () => {
  const page = crypto.randomUUID();
  const first = makeElement("mindmap.topic", page, 0, 0), second = makeElement("mindmap.subtopic", page, 0, 0);
  first.structure.parent_id = second.id;
  second.structure.parent_id = first.id;
  first.structure.collapsed = true;
  expect(() => mindmapLayout([first, second])).toThrow("循环");
});
