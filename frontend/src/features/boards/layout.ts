import { elementPatch, type Element, type Patch } from "./model";
const LAYOUT_TIMEOUT_MS = 15000;
export async function autoLayout(
  elements: Element[],
  direction: "RIGHT" | "DOWN",
  signal: AbortSignal,
): Promise<Patch[]> {
  if (elements.length > 500)
    throw new Error("自动布局最多处理 500 个图元，请先选择需要整理的部分。");
  if (signal.aborted) throw new DOMException("Layout cancelled", "AbortError");
  const worker = new Worker(new URL("./layout.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Layout cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error("布局计算超时，请缩小选择范围。"));
    }, LAYOUT_TIMEOUT_MS);
    worker.onerror = () => {
      cleanup();
      reject(new Error("布局计算失败，请重试。"));
    };
    worker.onmessage = (
      event: MessageEvent<{
        positions?: Array<{ id: string; x: number; y: number }>;
        error?: string;
      }>,
    ) => {
      cleanup();
      if (event.data.error) {
        reject(new Error("布局计算失败：" + event.data.error));
        return;
      }
      const source = new Map(elements.map((e) => [e.id, e])),
        patches: Patch[] = [];
      for (const position of event.data.positions ?? []) {
        const element = source.get(position.id);
        if (!element) continue;
        const dx = position.x + 80 - element.geometry.x,
          dy = position.y + 80 - element.geometry.y;
        patches.push(
          elementPatch(element, {
            geometry: {
              ...element.geometry,
              x: position.x + 80,
              y: position.y + 80,
            },
          }),
        );
        const descendants = new Set([element.id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const child of elements)
            if (
              child.structure.parent_id &&
              descendants.has(child.structure.parent_id) &&
              !descendants.has(child.id)
            ) {
              descendants.add(child.id);
              changed = true;
              patches.push(
                elementPatch(child, {
                  geometry: {
                    ...child.geometry,
                    x: child.geometry.x + dx,
                    y: child.geometry.y + dy,
                  },
                }),
              );
            }
        }
      }
      resolve(patches);
    };
    worker.postMessage({ elements, direction });
  });
}
const MINDMAP_HORIZONTAL_GAP = 64;
const MINDMAP_VERTICAL_GAP = 20;
const MINDMAP_MAX_DEPTH = 32;

/** 根主题保留当前位置；分支按实际尺寸及可见子树高度向右排布。 */
export function mindmapLayout(elements: Element[]): Patch[] {
  const topics = elements.filter(element => ["mindmap.root", "mindmap.topic", "mindmap.subtopic"].includes(element.shape_type));
  const nodes = new Map(topics.map(element => [element.id, element]));
  const byParent = new Map<string, Element[]>();
  for (const topic of topics) {
    const parent = topic.structure.parent_id ? nodes.get(topic.structure.parent_id) : undefined;
    if (!parent || parent.page_id !== topic.page_id) continue;
    const siblings = byParent.get(parent.id) ?? [];
    siblings.push(topic);
    byParent.set(parent.id, siblings);
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.structure.order - b.structure.order || a.id.localeCompare(b.id));
  // 折叠不能掩盖非法父级环；先验证完整主题关系，再仅布局可见节点。
  for (const topic of topics) {
    let current: Element | undefined = topic;
    const trail = new Set<string>();
    while (current) {
      if (trail.has(current.id) || trail.size > MINDMAP_MAX_DEPTH) throw new Error("思维导图层级存在循环或超出限制。");
      trail.add(current.id);
      const parent: Element | undefined = current.structure.parent_id ? nodes.get(current.structure.parent_id) : undefined;
      current = parent?.page_id === topic.page_id ? parent : undefined;
    }
  }
  const heights = new Map<string, number>();
  function height(node: Element): number {
    const children = node.structure.collapsed ? [] : byParent.get(node.id) ?? [];
    const value = Math.max(node.geometry.height, children.reduce((sum, child) => sum + height(child), 0) + Math.max(0, children.length - 1) * MINDMAP_VERTICAL_GAP);
    heights.set(node.id, value);
    return value;
  }
  const patches: Patch[] = [];
  function place(node: Element, x: number, centerY: number) {
    const y = centerY - node.geometry.height / 2;
    if (x !== node.geometry.x || y !== node.geometry.y) patches.push(elementPatch(node, { geometry: { ...node.geometry, x, y } }));
    const children = node.structure.collapsed ? [] : byParent.get(node.id) ?? [];
    const total = children.reduce((sum, child) => sum + heights.get(child.id)!, 0) + Math.max(0, children.length - 1) * MINDMAP_VERTICAL_GAP;
    let top = centerY - total / 2;
    for (const child of children) {
      const childHeight = heights.get(child.id)!;
      place(child, x + node.geometry.width + MINDMAP_HORIZONTAL_GAP, top + childHeight / 2);
      top += childHeight + MINDMAP_VERTICAL_GAP;
    }
  }
  for (const root of topics.filter(topic => {
    const parent = topic.structure.parent_id ? nodes.get(topic.structure.parent_id) : undefined;
    return !parent || parent.page_id !== topic.page_id;
  })) {
    height(root);
    place(root, root.geometry.x, root.geometry.y + root.geometry.height / 2);
  }
  return patches;
}
