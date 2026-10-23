import ELK from "elkjs/lib/elk-api";
import elkWorkerURL from "elkjs/lib/elk-worker.min.js?url";
import type { Element } from "./model";
self.onmessage = async (
  event: MessageEvent<{ elements: Element[]; direction: "RIGHT" | "DOWN" }>,
) => {
  const elk = new ELK({ workerUrl: elkWorkerURL });
  try {
    const nodes = event.data.elements.filter(
      (e) => e.shape_type !== "connector" && !e.structure.parent_id,
    );
    const ids = new Set(nodes.map((e) => e.id));
    const edges = event.data.elements.filter(
      (e) =>
        e.shape_type === "connector" &&
        ids.has(e.structure.start?.element_id ?? "") &&
        ids.has(e.structure.end?.element_id ?? ""),
    );
    const result = await elk.layout({
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": event.data.direction,
        "elk.spacing.nodeNode": "60",
        "elk.layered.spacing.nodeNodeBetweenLayers": "100",
        "elk.edgeRouting": "ORTHOGONAL",
      },
      children: nodes.map((e) => ({
        id: e.id,
        width: e.geometry.width,
        height: e.geometry.height,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        sources: [e.structure.start!.element_id!],
        targets: [e.structure.end!.element_id!],
      })),
    });
    elk.terminateWorker();
    self.postMessage({
      positions: (result.children ?? []).map((n) => ({
        id: n.id,
        x: n.x ?? 0,
        y: n.y ?? 0,
      })),
    });
  } catch (error) {
    elk.terminateWorker();
    self.postMessage({ error: (error as Error).message });
  }
};
