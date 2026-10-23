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
export function mindmapLayout(elements: Element[]): Patch[] {
  const topics = elements.filter(
      (e) =>
        e.shape_type.startsWith("mindmap.") &&
        e.shape_type !== "mindmap.relationship",
    ),
    byParent = new Map<string, Element[]>();
  const ids = new Set(topics.map((e) => e.id));
  for (const topic of topics) {
    const parent = topic.structure.parent_id ?? "";
    const siblings = byParent.get(parent) ?? [];
    siblings.push(topic);
    byParent.set(parent, siblings);
  }
  const patches: Patch[] = [];
  let y = 80;
  const seen = new Set<string>();
  function place(node: Element, depth: number): number {
    if (seen.has(node.id) || depth > 32)
      throw new Error("思维导图层级存在循环或超出限制。");
    seen.add(node.id);
    const children = (byParent.get(node.id) ?? []).sort(
      (a, b) => a.structure.order - b.structure.order,
    );
    const positions = children.map((child) => place(child, depth + 1));
    const center = positions.length
      ? (positions[0] + positions.at(-1)!) / 2
      : y;
    if (!positions.length) y += Math.max(110, node.geometry.height + 30);
    patches.push(
      elementPatch(node, {
        geometry: { ...node.geometry, x: 80 + depth * 280, y: center },
      }),
    );
    return center;
  }
  for (const root of topics.filter(
    (e) => !e.structure.parent_id || !ids.has(e.structure.parent_id),
  ))
    place(root, 0);
  return patches;
}
