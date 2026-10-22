import {
  elementPatch,
  MAX_COMMAND_ELEMENTS,
  type Element,
  type Geometry,
  type Patch,
} from "./model";

export function branchIDs(
  scene: Map<string, Element>,
  root: string,
): Set<string> {
  const ids = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of scene.values())
      if (
        e.structure.parent_id &&
        ids.has(e.structure.parent_id) &&
        !ids.has(e.id)
      ) {
        ids.add(e.id);
        changed = true;
      }
  }
  return ids;
}
export function transformBranch(
  scene: Map<string, Element>,
  root: Element,
  next: Geometry,
): Patch[] {
  const ids = branchIDs(scene, root.id);
  if (ids.size > MAX_COMMAND_ELEMENTS)
    throw new Error("本次容器变换超过 500 个对象，请缩小范围。");
  const old = root.geometry,
    sx = next.width / old.width,
    sy = next.height / old.height,
    angle = next.rotation_rad - old.rotation_rad;
  const point = (x: number, y: number) => {
    const dx = x - old.x - old.width / 2,
      dy = y - old.y - old.height / 2;
    const localX =
      (dx * Math.cos(-old.rotation_rad) - dy * Math.sin(-old.rotation_rad)) *
      sx;
    const localY =
      (dx * Math.sin(-old.rotation_rad) + dy * Math.cos(-old.rotation_rad)) *
      sy;
    return {
      x:
        next.x +
        next.width / 2 +
        localX * Math.cos(next.rotation_rad) -
        localY * Math.sin(next.rotation_rad),
      y:
        next.y +
        next.height / 2 +
        localX * Math.sin(next.rotation_rad) +
        localY * Math.cos(next.rotation_rad),
    };
  };
  const patches: Patch[] = [elementPatch(root, { geometry: next })];
  for (const e of scene.values()) {
    if (e.id === root.id) continue;
    if (e.shape_type === "connector") {
      const start = e.structure.start?.element_id,
        end = e.structure.end?.element_id;
      if (
        e.structure.points.length &&
        ((start && end && ids.has(start) && ids.has(end)) || ids.has(e.id))
      )
        patches.push(
          elementPatch(e, {
            structure: {
              ...e.structure,
              points: e.structure.points.map((p) => point(p.x, p.y)),
            },
          }),
        );
    } else if (ids.has(e.id)) {
      if (
        Math.abs(sx - sy) > 0.0001 &&
        Math.abs(e.geometry.rotation_rad - old.rotation_rad) > 0.0001
      )
        throw new Error("容器内有旋转对象，请保持等比例缩放。");
      const center = point(
        e.geometry.x + e.geometry.width / 2,
        e.geometry.y + e.geometry.height / 2,
      );
      const width = e.geometry.width * sx,
        height = e.geometry.height * sy;
      patches.push(
        elementPatch(e, {
          geometry: {
            ...e.geometry,
            x: center.x - width / 2,
            y: center.y - height / 2,
            width,
            height,
            rotation_rad: (e.geometry.rotation_rad + angle) % (2 * Math.PI),
          },
        }),
      );
    }
  }
  if (patches.length > MAX_COMMAND_ELEMENTS)
    throw new Error("本次变换超过 500 个对象，请缩小范围。");
  return patches;
}

export function reorderLane(
  scene: Map<string, Element>,
  lane: Element,
  direction: number,
): Patch[] {
  const vertical = lane.shape_type === "swimlane.vertical",
    axis = vertical ? "x" : "y";
  const siblings = [...scene.values()]
    .filter(
      (e) =>
        e.shape_type === lane.shape_type &&
        e.structure.parent_id === lane.structure.parent_id,
    )
    .sort((a, b) => a.geometry[axis] - b.geometry[axis]);
  const index = siblings.findIndex((e) => e.id === lane.id),
    other = siblings[index + direction];
  if (!other) return [];
  const patches = [
    ...transformBranch(scene, lane, {
      ...lane.geometry,
      [axis]: other.geometry[axis],
    }),
    ...transformBranch(scene, other, {
      ...other.geometry,
      [axis]: lane.geometry[axis],
    }),
  ];
  if (patches.length > MAX_COMMAND_ELEMENTS)
    throw new Error("泳道内容过多，请缩小调整范围。");
  return patches;
}

export function selectionForCopy(
  scene: Map<string, Element>,
  selected: Set<string>,
): Element[] {
  const ids = new Set<string>();
  for (const id of selected)
    for (const descendant of branchIDs(scene, id)) ids.add(descendant);
  for (const edge of scene.values()) {
    const a = edge.structure.start?.element_id,
      b = edge.structure.end?.element_id;
    if (edge.shape_type === "connector" && a && b && ids.has(a) && ids.has(b))
      ids.add(edge.id);
  }
  if (ids.size > MAX_COMMAND_ELEMENTS)
    throw new Error("单次复制最多 500 个对象，请缩小选择范围。");
  return [...ids].map((id) => scene.get(id)).filter((e): e is Element => !!e);
}
