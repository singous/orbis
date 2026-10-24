import { expect, it } from "vitest";
import { appendTopic, createMindmap, hiddenElements, isMindmapTopic, mindmapDescendants, toggleTopicCollapsed } from "./mindmap";
import { makeElement, type Command, type Element } from "./model";

function apply(scene: Map<string, Element>, commands: Command[]) {
  for (const command of commands) {
    if (command.type === "elements.create") for (const element of command.elements) scene.set(element.id, element);
    if (command.type === "elements.update") for (const patch of command.patches) {
      const element = scene.get(patch.id)!;
      scene.set(element.id, { ...element, ...(patch.geometry ? { geometry: patch.geometry } : {}), ...(patch.structure ? { structure: patch.structure } : {}) });
    }
  }
}

it("creates a purple center with styled main branches, children and bound curves", () => {
  const page = crypto.randomUUID(), { elements, rootID } = createMindmap(page, { x: 120, y: 220 });
  const scene = new Map(elements.map(element => [element.id, element]));
  const root = scene.get(rootID)!;
  expect(elements).toHaveLength(19);
  expect(root.geometry).toMatchObject({ x: 120, y: 220, width: 200, height: 44 });
  expect(root.style).toMatchObject({ fill: "#7568c8", text_color: "#ffffff", bold: true, font_size: 16 });
  expect(elements.filter(element => element.shape_type === "mindmap.topic")).toHaveLength(3);
  expect(elements.filter(element => element.shape_type === "mindmap.subtopic")).toHaveLength(6);
  for (const element of elements) {
    expect(element.page_id).toBe(page);
    if (isMindmapTopic(element) && element.id !== rootID) expect(element.style).toMatchObject({ fill: "transparent", align: "left", stroke: "#8b83c1" });
    if (element.shape_type === "connector") {
      expect(element.structure).toMatchObject({ route: "curve", end_marker: "none" });
      expect(scene.has(element.structure.start!.element_id!)).toBe(true);
      expect(scene.has(element.structure.end!.element_id!)).toBe(true);
    }
  }
  expect(mindmapDescendants(scene, rootID)).toHaveLength(9);
  for (const type of ["mindmap.summary", "mindmap.boundary", "mindmap.relationship"]) expect(isMindmapTopic(makeElement(type, page, 0, 0))).toBe(false);
});

it("adds the proper level and preserves existing authored styles while reflowing its tree", () => {
  const { elements, rootID } = createMindmap(crypto.randomUUID(), { x: 500, y: 300 });
  const scene = new Map(elements.map(element => [element.id, element]));
  const branch = elements.find(element => element.shape_type === "mindmap.topic")!;
  branch.style = { ...branch.style, fill: "#fef3c7", stroke: "#e11d48", font_size: 22 };
  branch.geometry.width = 320;
  const before = JSON.stringify(elements);
  const child = appendTopic(branch, scene, false);
  expect(JSON.stringify(elements)).toBe(before);
  const created = child.commands.at(-1)!;
  if (created.type !== "elements.create") throw Error("expected creation");
  expect(created.elements[0]).toMatchObject({ shape_type: "mindmap.subtopic", style: { fill: "transparent", stroke: "#e11d48" }, structure: { parent_id: branch.id } });
  expect(created.elements[0].geometry.x).toBe(branch.geometry.x + 320 + 64);
  for (const command of child.commands) if (command.type === "elements.update") for (const patch of command.patches) expect(patch.style).toBeUndefined();
  apply(scene, child.commands);
  expect(scene.get(branch.id)!.style).toBe(branch.style);
  const sibling = appendTopic(branch, scene, true).commands.at(-1)!;
  if (sibling.type !== "elements.create") throw Error("expected creation");
  expect(sibling.elements[0]).toMatchObject({ shape_type: "mindmap.topic", structure: { parent_id: rootID } });
});

it("collapses each level without deleting data and restores nested collapsed state", () => {
  const { elements, rootID } = createMindmap(crypto.randomUUID(), { x: 40, y: 90 });
  const scene = new Map(elements.map(element => [element.id, element]));
  const branch = elements.find(element => element.shape_type === "mindmap.topic")!;
  const originalGeometry = JSON.stringify(elements.map(element => element.geometry));
  apply(scene, toggleTopicCollapsed(branch, scene));
  expect(hiddenElements(scene).size).toBe(4);
  apply(scene, toggleTopicCollapsed(scene.get(rootID)!, scene));
  expect(hiddenElements(scene).size).toBe(18);
  apply(scene, toggleTopicCollapsed(scene.get(rootID)!, scene));
  expect(hiddenElements(scene).size).toBe(4);
  expect(scene.get(branch.id)!.structure.collapsed).toBe(true);
  apply(scene, toggleTopicCollapsed(scene.get(branch.id)!, scene));
  expect(hiddenElements(scene).size).toBe(0);
  expect(scene.size).toBe(elements.length);
  expect(JSON.stringify([...scene.values()].map(element => element.geometry))).toBe(originalGeometry);
});

it("expands a collapsed parent when adding a child and leaves other trees untouched", () => {
  const first = createMindmap(crypto.randomUUID(), { x: 100, y: 100 });
  const second = createMindmap(first.elements[0].page_id, { x: 1700, y: 800 });
  const scene = new Map([...first.elements, ...second.elements].map(element => [element.id, element]));
  const root = scene.get(first.rootID)!;
  root.structure.collapsed = true;
  const result = appendTopic(root, scene, false);
  const touched = result.commands.flatMap(command => command.type === "elements.update" ? command.patches.map(patch => patch.id) : []);
  expect(touched.some(id => second.elements.some(element => element.id === id))).toBe(false);
  apply(scene, result.commands);
  expect(scene.get(first.rootID)!.structure.collapsed).toBe(false);
  expect(hiddenElements(scene).has(result.id)).toBe(false);
});

it.each(["mindmap.summary", "mindmap.boundary", "mindmap.relationship"])("preserves adding topics to existing %s elements", shape => {
  const parent = makeElement(shape, crypto.randomUUID(), 100, 180);
  parent.structure.collapsed = true;
  const before = JSON.stringify(parent), scene = new Map([[parent.id, parent]]);
  const first = appendTopic(parent, scene, false);
  expect(JSON.stringify(parent)).toBe(before);
  apply(scene, first.commands);
  const child = scene.get(first.id)!;
  expect(child.structure.parent_id).toBe(parent.id);
  expect(scene.get(parent.id)!.structure.collapsed).toBe(false);
  const second = appendTopic(parent, scene, false);
  const creation = second.commands.at(-1)!;
  if (creation.type !== "elements.create") throw Error("expected creation");
  expect(creation.elements[0].geometry.y).toBe(child.geometry.y + child.geometry.height + 30);
});

it.each(["mindmap.boundary", "basic.frame"])("keeps Enter creating a sibling under an existing %s parent", shape => {
  const parent = makeElement(shape, crypto.randomUUID(), 100, 180);
  const child = makeElement("mindmap.topic", parent.page_id, 400, 180);
  child.structure.parent_id = parent.id;
  const scene = new Map([parent, child].map(element => [element.id, element]));
  const result = appendTopic(child, scene, true);
  const creation = result.commands.at(-1)!;
  if (creation.type !== "elements.create") throw Error("expected creation");
  expect(creation.elements[0].structure.parent_id).toBe(parent.id);
  expect(creation.elements[0].geometry.y).toBe(child.geometry.y + child.geometry.height + 30);
});

function visibleOverlaps(scene: Map<string, Element>) {
  const hidden = hiddenElements(scene);
  const topics = [...scene.values()].filter(node => isMindmapTopic(node) && !hidden.has(node.id));
  return topics.flatMap((a, index) => topics.slice(index + 1).filter(b =>
    a.geometry.x < b.geometry.x + b.geometry.width && a.geometry.x + a.geometry.width > b.geometry.x &&
    a.geometry.y < b.geometry.y + b.geometry.height && a.geometry.y + a.geometry.height > b.geometry.y,
  ).map(b => [a.id, b.id]));
}

it.each(["sibling", "neighbor child"])("reflows expansion after adding a %s while retaining data and other trees", operation => {
  const tree = createMindmap(crypto.randomUUID(), { x: 120, y: 220 });
  const otherTree = createMindmap(tree.elements[0].page_id, { x: 1700, y: 900 });
  const annotation = makeElement("flow.process", tree.elements[0].page_id, 3000, 1200);
  const scene = new Map([...tree.elements, ...otherTree.elements, annotation].map(node => [node.id, node]));
  const branches = tree.elements.filter(node => node.shape_type === "mindmap.topic");
  apply(scene, toggleTopicCollapsed(branches[0], scene));
  const added = operation === "sibling" ? appendTopic(scene.get(branches[0].id)!, scene, true) : appendTopic(scene.get(branches[1].id)!, scene, false);
  apply(scene, added.commands);
  for (const [index, node] of [...scene.values()].entries()) scene.set(node.id, { ...node, versions: { geometry: index + 11, structure: index + 21, text: index + 31, style: index + 41 } });
  const before = JSON.stringify([...scene.values()]);
  const rootGeometry = scene.get(tree.rootID)!.geometry;
  const commands = toggleTopicCollapsed(scene.get(branches[0].id)!, scene);
  expect(JSON.stringify([...scene.values()])).toBe(before);
  expect(commands).toHaveLength(1);
  const update = commands[0];
  if (update.type !== "elements.update") throw Error("expected atomic expansion");
  expect(new Set(update.patches.map(patch => patch.id)).size).toBe(update.patches.length);
  expect(update.patches.some(patch => patch.geometry)).toBe(true);
  for (const patch of update.patches) {
    expect(patch.expected).toEqual(scene.get(patch.id)!.versions);
    expect(patch.style).toBeUndefined();
    expect(patch.text).toBeUndefined();
    expect(tree.elements.some(node => node.id === patch.id) || patch.id === added.id).toBe(true);
  }
  const originals = new Map(scene);
  apply(scene, commands);
  expect(visibleOverlaps(scene)).toEqual([]);
  expect(scene.get(tree.rootID)!.geometry).toEqual(rootGeometry);
  expect(scene.get(branches[0].id)!.structure.collapsed).toBe(false);
  expect(scene.has(added.id)).toBe(true);
  expect(scene.size).toBe(originals.size);
  for (const [id, original] of originals) {
    const node = scene.get(id)!;
    expect(node.style).toEqual(original.style);
    expect(node.text).toBe(original.text);
    expect(node.structure).toEqual(id === branches[0].id ? { ...original.structure, collapsed: false } : original.structure);
  }
  for (const node of [...otherTree.elements, annotation]) expect(scene.get(node.id)).toEqual(originals.get(node.id));
});

it("keeps nested collapsed branches and their hidden descendants intact when reflowing an expansion", () => {
  const tree = createMindmap(crypto.randomUUID(), { x: 80, y: 120 });
  const scene = new Map(tree.elements.map(node => [node.id, node]));
  const branch = tree.elements.find(node => node.shape_type === "mindmap.topic")!;
  const nested = tree.elements.find(node => node.shape_type === "mindmap.subtopic" && node.structure.parent_id === branch.id)!;
  const grandchild = appendTopic(nested, scene, false);
  apply(scene, grandchild.commands);
  apply(scene, toggleTopicCollapsed(scene.get(nested.id)!, scene));
  apply(scene, toggleTopicCollapsed(scene.get(branch.id)!, scene));
  apply(scene, appendTopic(scene.get(branch.id)!, scene, true).commands);
  const hiddenBefore = scene.get(grandchild.id)!;
  const commands = toggleTopicCollapsed(scene.get(branch.id)!, scene);
  apply(scene, commands);
  expect(scene.get(nested.id)!.structure.collapsed).toBe(true);
  expect(hiddenElements(scene).has(nested.id)).toBe(false);
  expect(hiddenElements(scene).has(grandchild.id)).toBe(true);
  expect(scene.get(grandchild.id)).toEqual(hiddenBefore);
  expect(visibleOverlaps(scene)).toEqual([]);
});
