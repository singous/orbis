import { isMemberShape, portPosition } from "./geometry";
import { type Element, type Endpoint, type Point } from "./model";

/** 以屏幕像素定义，缩放画布时保持相同的连接点吸附范围。 */
export const CONNECTION_SNAP_RADIUS = 18;

export type ConnectionPort = {
  elementID: string;
  port: string;
  point: Point;
  label: string;
};

const SIDE_LABELS = {
  top: "上侧连接点",
  right: "右侧连接点",
  bottom: "下侧连接点",
  left: "左侧连接点",
};
const LIFELINE_POSITIONS = [0.2, 0.4, 0.6, 0.8, 1];
const MAX_PARENT_DEPTH = 32;

export function connectionPorts(element: Element): ConnectionPort[] {
  if (element.shape_type === "connector") return [];
  const ports: Array<{ port: string; label: string }> =
    element.shape_type === "uml.lifeline"
      ? [
          { port: "top", label: SIDE_LABELS.top },
          ...LIFELINE_POSITIONS.map((position) => ({
            port: `time:${position}`,
            label: `生命线 ${Math.round(position * 100)}% 连接点`,
          })),
        ]
      : Object.entries(SIDE_LABELS).map(([port, label]) => ({ port, label }));
  if (isMemberShape(element)) {
    for (const member of element.structure.members) {
      ports.push(
        { port: `left:${member.id}`, label: `${member.name} 左侧连接点` },
        { port: `right:${member.id}`, label: `${member.name} 右侧连接点` },
      );
    }
  }
  return ports.map(({ port, label }) => ({
    elementID: element.id,
    port,
    point: portPosition(element, port),
    label,
  }));
}

function hasCollapsedAncestor(
  element: Element,
  elements: ReadonlyMap<string, Element>,
): boolean {
  const visited = new Set([element.id]);
  let parentID = element.structure.parent_id;
  while (parentID) {
    if (visited.has(parentID) || visited.size > MAX_PARENT_DEPTH) return true;
    visited.add(parentID);
    const parent = elements.get(parentID);
    if (!parent) return false;
    if (parent.structure.collapsed) return true;
    parentID = parent.structure.parent_id;
  }
  return false;
}

/** 候选集通常是当前页面；指定起点时同时排除起点及其他页面。 */
export function findConnectionPort(
  elements: ReadonlyMap<string, Element>,
  point: Point,
  zoom: number,
  excludeElementID?: string,
  visibleIDs?: ReadonlySet<string>,
): ConnectionPort | null {
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  const sourcePage = excludeElementID
    ? elements.get(excludeElementID)?.page_id
    : undefined;
  let closest: ConnectionPort | null = null,
    closestOrder = -Infinity,
    distanceSquared = (CONNECTION_SNAP_RADIUS / zoom) ** 2;
  for (const element of elements.values()) {
    if (
      element.id === excludeElementID ||
      element.shape_type === "connector" ||
      element.style.opacity <= 0 ||
      (sourcePage !== undefined && element.page_id !== sourcePage) ||
      (visibleIDs !== undefined && !visibleIDs.has(element.id)) ||
      hasCollapsedAncestor(element, elements)
    )
      continue;
    for (const port of connectionPorts(element)) {
      const distance =
        (port.point.x - point.x) ** 2 + (port.point.y - point.y) ** 2;
      if (
        distance < distanceSquared ||
        (distance === distanceSquared && element.structure.order > closestOrder)
      ) {
        closest = port;
        closestOrder = element.structure.order;
        distanceSquared = distance;
      }
    }
  }
  return closest;
}

export function connectionEndpoint(port: ConnectionPort): Endpoint {
  return { element_id: port.elementID, port: port.port, ...port.point };
}
