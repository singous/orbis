import { elementPatch, makeElement, type Command, type Element } from "./model";

export function appendTopic(
  selected: Element,
  scene: Map<string, Element>,
  sibling: boolean,
): { commands: Command[]; id: string } {
  const parent =
    sibling && selected.structure.parent_id
      ? (scene.get(selected.structure.parent_id) ?? selected)
      : selected;
  const children = [...scene.values()].filter(
    (e) =>
      e.structure.parent_id === parent.id &&
      e.shape_type.startsWith("mindmap."),
  );
  const node = makeElement(
    "mindmap.topic",
    parent.page_id,
    parent.geometry.x + parent.geometry.width + 100,
    children.length
      ? Math.max(...children.map((e) => e.geometry.y + e.geometry.height)) + 30
      : parent.geometry.y,
  );
  node.text = "新主题";
  node.structure.parent_id = parent.id;
  node.structure.order = children.length;
  const edge = makeElement("connector", parent.page_id, 0, 0);
  edge.structure.start = { element_id: parent.id, port: "right", x: 0, y: 0 };
  edge.structure.end = { element_id: node.id, port: "left", x: 0, y: 0 };
  edge.structure.route = "curve";
  edge.structure.end_marker = "none";
  edge.style.stroke = node.style.stroke;
  const commands: Command[] = [];
  if (parent.structure.collapsed)
    commands.push({
      type: "elements.update",
      patches: [
        elementPatch(parent, {
          structure: { ...parent.structure, collapsed: false },
        }),
      ],
    });
  commands.push({ type: "elements.create", elements: [node, edge] });
  return { commands, id: node.id };
}

export function hiddenElements(scene: Map<string, Element>): Set<string> {
  const hidden = new Set<string>(),
    resolved = new Set<string>();
  function visit(id: string, trail: Set<string>): boolean {
    if (resolved.has(id)) return hidden.has(id);
    if (trail.has(id) || trail.size > 32) return true;
    trail.add(id);
    const parentID = scene.get(id)?.structure.parent_id;
    const parent = parentID ? scene.get(parentID) : undefined;
    const hide =
      !!parent && (parent.structure.collapsed || visit(parent.id, trail));
    trail.delete(id);
    resolved.add(id);
    if (hide) hidden.add(id);
    return hide;
  }
  for (const id of scene.keys()) visit(id, new Set());
  for (const e of scene.values())
    if (
      e.shape_type === "connector" &&
      [e.structure.start?.element_id, e.structure.end?.element_id].some(
        (id) => id && hidden.has(id),
      )
    )
      hidden.add(e.id);
  return hidden;
}

export function reparentElement(
  scene: Map<string, Element>,
  element: Element,
  parentID: string | null,
): Command[] {
  let ancestor = parentID;
  for (let depth = 0; ancestor; depth++) {
    if (ancestor === element.id || depth > 32)
      throw new Error("不能将对象移动到自身的子级。");
    ancestor = scene.get(ancestor)?.structure.parent_id ?? null;
  }
  const commands: Command[] = [
    {
      type: "elements.update",
      patches: [
        elementPatch(element, {
          structure: { ...element.structure, parent_id: parentID },
        }),
      ],
    },
  ];
  if (!element.shape_type.startsWith("mindmap.")) return commands;
  const parent = parentID ? scene.get(parentID) : undefined;
  const edges = [...scene.values()].filter(
    (e) =>
      e.shape_type === "connector" &&
      e.structure.start?.element_id === element.structure.parent_id &&
      e.structure.end?.element_id === element.id,
  );
  if (parent?.shape_type.startsWith("mindmap.")) {
    if (edges.length)
      commands.push({
        type: "elements.update",
        patches: edges.map((edge) =>
          elementPatch(edge, {
            structure: {
              ...edge.structure,
              start: { element_id: parent.id, port: "right", x: 0, y: 0 },
            },
          }),
        ),
      });
    else {
      const edge = makeElement("connector", element.page_id, 0, 0);
      edge.structure.start = {
        element_id: parent.id,
        port: "right",
        x: 0,
        y: 0,
      };
      edge.structure.end = { element_id: element.id, port: "left", x: 0, y: 0 };
      edge.structure.route = "curve";
      edge.structure.end_marker = "none";
      commands.push({ type: "elements.create", elements: [edge] });
    }
  } else if (edges.length)
    commands.push({
      type: "elements.delete",
      targets: edges.map((e) => ({ id: e.id, version: e.version })),
    });
  return commands;
}
