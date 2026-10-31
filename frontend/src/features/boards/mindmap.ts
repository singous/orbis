import { mindmapLayout } from "./layout";
import { elementPatch, makeElement, type Command, type Element, type Point } from "./model";

const ROOT_FILL = "#7568c8";
const BRANCH_STROKE = "#8b83c1";
const MAX_TOPIC_DEPTH = 32;

export function isMindmapTopic(element: Element): boolean {
  return ["mindmap.root", "mindmap.topic", "mindmap.subtopic"].includes(element.shape_type);
}

export function mindmapDescendants(scene: ReadonlyMap<string, Element>, rootID: string): Element[] {
  const root = scene.get(rootID);
  if (!root || !isMindmapTopic(root)) return [];
  const byParent = new Map<string, Element[]>();
  for (const element of scene.values()) {
    if (!isMindmapTopic(element) || element.page_id !== root.page_id || !element.structure.parent_id) continue;
    const children = byParent.get(element.structure.parent_id) ?? [];
    children.push(element);
    byParent.set(element.structure.parent_id, children);
  }
  const result: Element[] = [], seen = new Set([rootID]);
  const queue = [...(byParent.get(rootID) ?? [])];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    result.push(node);
    queue.push(...(byParent.get(node.id) ?? []));
  }
  return result;
}

function topicElement(shape: "mindmap.root" | "mindmap.topic" | "mindmap.subtopic", pageID: string, point: Point, stroke = BRANCH_STROKE): Element {
  const node = makeElement(shape, pageID, point.x, point.y);
  const root = shape === "mindmap.root";
  node.geometry = { ...node.geometry, width: root ? 200 : shape === "mindmap.topic" ? 180 : 160, height: root ? 44 : shape === "mindmap.topic" ? 40 : 36 };
  node.style = { ...node.style, fill: root ? ROOT_FILL : "transparent", stroke: root ? ROOT_FILL : stroke, text_color: root ? "#ffffff" : node.style.text_color, bold: root, font_size: root ? 16 : 14, align: root ? "center" : "left" };
  return node;
}
function topicEdge(parent: Element, child: Element): Element {
  const edge = makeElement("connector", parent.page_id, 0, 0);
  edge.structure.start = { element_id: parent.id, port: "right", x: 0, y: 0 };
  edge.structure.end = { element_id: child.id, port: "left", x: 0, y: 0 };
  edge.structure.route = "curve";
  edge.structure.end_marker = "none";
  edge.style.stroke = child.style.stroke;
  return edge;
}
function topicRoot(node: Element, scene: ReadonlyMap<string, Element>): Element {
  let root = node;
  const trail = new Set<string>();
  while (root.structure.parent_id) {
    if (trail.has(root.id) || trail.size > MAX_TOPIC_DEPTH) throw new Error("思维导图层级存在循环或超出限制。");
    trail.add(root.id);
    const ancestor = scene.get(root.structure.parent_id);
    if (!ancestor || !isMindmapTopic(ancestor) || ancestor.page_id !== node.page_id) break;
    root = ancestor;
  }
  return root;
}
export function createMindmap(pageID: string, point: Point): { elements: Element[]; rootID: string } {
  const root = topicElement("mindmap.root", pageID, point);
  root.text = "中心主题";
  const elements = [root];
  for (let branchIndex = 0; branchIndex < 3; branchIndex++) {
    const branch = topicElement("mindmap.topic", pageID, point);
    branch.text = `分支主题 ${branchIndex + 1}`;
    branch.structure.parent_id = root.id;
    branch.structure.order = elements.length;
    elements.push(branch, topicEdge(root, branch));
    for (let childIndex = 0; childIndex < 2; childIndex++) {
      const child = topicElement("mindmap.subtopic", pageID, point, branch.style.stroke);
      child.text = `子主题 ${childIndex + 1}`;
      child.structure.parent_id = branch.id;
      child.structure.order = elements.length;
      elements.push(child, topicEdge(branch, child));
    }
  }
  const positions = new Map(mindmapLayout(elements).map(patch => [patch.id, patch.geometry!]));
  for (const element of elements) {
    element.structure.order = elements.indexOf(element);
    if (positions.has(element.id)) element.geometry = positions.get(element.id)!;
  }
  return { elements, rootID: root.id };
}

export function appendTopic(selected: Element, scene: Map<string, Element>, sibling: boolean): { commands: Command[]; id: string } {
  if (!selected.shape_type.startsWith("mindmap.")) throw new Error("只能为思维导图主题添加分支。");
  const candidate = sibling && selected.structure.parent_id ? scene.get(selected.structure.parent_id) : undefined;
  const parent = candidate ?? selected;
  if (!isMindmapTopic(parent)) {
    // 旧画板允许为概要、边界等辅助图元添加主题；保留该快捷键行为及其原有定位规则。
    const children = [...scene.values()].filter(node => node.structure.parent_id === parent.id && node.shape_type.startsWith("mindmap."));
    const node = topicElement("mindmap.topic", parent.page_id, {
      x: parent.geometry.x + parent.geometry.width + 100,
      y: children.length ? Math.max(...children.map(child => child.geometry.y + child.geometry.height)) + 30 : parent.geometry.y,
    });
    node.text = "新主题";
    node.structure.parent_id = parent.id;
    node.structure.order = children.length;
    const commands: Command[] = parent.structure.collapsed ? [{ type: "elements.update", patches: [elementPatch(parent, { structure: { ...parent.structure, collapsed: false } })] }] : [];
    commands.push({ type: "elements.create", elements: [node, topicEdge(parent, node)] });
    return { commands, id: node.id };
  }
  const root = topicRoot(parent, scene);
  const children = [...scene.values()].filter(node => isMindmapTopic(node) && node.structure.parent_id === parent.id && node.page_id === parent.page_id);
  const node = topicElement(parent.shape_type === "mindmap.root" ? "mindmap.topic" : "mindmap.subtopic", parent.page_id, { x: parent.geometry.x + parent.geometry.width + 64, y: parent.geometry.y }, parent.shape_type === "mindmap.root" ? BRANCH_STROKE : parent.style.stroke);
  node.text = "新主题";
  node.structure.parent_id = parent.id;
  node.structure.order = Math.max(-1, ...children.map(child => child.structure.order)) + 1;
  const edge = topicEdge(parent, node);
  edge.structure.order = Math.max(0, ...[...scene.values()].map(element => element.structure.order)) + 1;
  const nextParent = parent.structure.collapsed ? { ...parent, structure: { ...parent.structure, collapsed: false } } : parent;
  const layoutScene = new Map(scene);
  layoutScene.set(parent.id, nextParent);
  layoutScene.set(node.id, node);
  const tree = [layoutScene.get(root.id)!, ...mindmapDescendants(layoutScene, root.id)];
  const patches = mindmapLayout(tree);
  const nodePatch = patches.find(patch => patch.id === node.id);
  if (nodePatch?.geometry) node.geometry = nodePatch.geometry;
  const existingPatches = patches.filter(patch => patch.id !== node.id);
  if (parent.structure.collapsed) {
    const parentPatch = existingPatches.find(patch => patch.id === parent.id);
    if (parentPatch) parentPatch.structure = nextParent.structure;
    else existingPatches.push(elementPatch(parent, { structure: nextParent.structure }));
  }
  const commands: Command[] = [];
  if (existingPatches.length) commands.push({ type: "elements.update", patches: existingPatches });
  commands.push({ type: "elements.create", elements: [node, edge] });
  return { commands, id: node.id };
}

export function toggleTopicCollapsed(node: Element, scene: ReadonlyMap<string, Element>): Command[] {
  const current = scene.get(node.id);
  if (!current || !isMindmapTopic(current) || !mindmapDescendants(scene, current.id).length) return [];
  const structure = { ...current.structure, collapsed: !current.structure.collapsed };
  if (structure.collapsed) return [{ type: "elements.update", patches: [elementPatch(current, { structure })] }];
  // 展开时按当前可见子树重新分配空间；结构与位置合成一次更新，保持版本校验和撤销的原子性。
  const expanded = { ...current, structure };
  const layoutScene = new Map(scene).set(current.id, expanded);
  const root = topicRoot(expanded, layoutScene);
  const patches = mindmapLayout([root, ...mindmapDescendants(layoutScene, root.id)]);
  const ownPatch = patches.find(patch => patch.id === current.id);
  if (ownPatch) ownPatch.structure = structure;
  else patches.push(elementPatch(current, { structure }));
  return [{ type: "elements.update", patches }];
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
