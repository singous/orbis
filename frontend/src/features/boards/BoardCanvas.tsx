import { useEffect, useRef, useState, type RefObject } from "react";
import { BoardRenderer, type Camera } from "./renderer";
import { elementBounds, portPosition, unionBounds } from "./geometry";
import {
  elementPatch,
  makeElement,
  type Command,
  type Element,
  type Point,
} from "./model";
import { elementSchema } from "./model";
import { selectionForCopy, transformBranch } from "./transforms";
import { appendTopic } from "./mindmap";
import { cloneElements } from "./templates";

export type BoardTool = "select" | "pan" | "connect" | "draw" | string;
type Props = {
  elements: Map<string, Element>;
  pageID: string;
  selection: Set<string>;
  onSelection: (ids: Set<string>) => void;
  camera: Camera;
  onCamera: (camera: Camera) => void;
  tool: BoardTool;
  onTool: (tool: BoardTool) => void;
  submit: (commands: Command[]) => Promise<void>;
  readOnly: boolean;
  rendererRef: RefObject<BoardRenderer | null>;
  onError: (error: unknown) => void;
  onUndo: () => void;
  onRedo: () => void;
  resolveImage?: (id: string) => Promise<HTMLCanvasElement>;
};
function descendants(elements: Map<string, Element>, selection: Set<string>) {
  const ids = new Set(selection);
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of elements.values())
      if (
        element.structure.parent_id &&
        ids.has(element.structure.parent_id) &&
        !ids.has(element.id)
      ) {
        ids.add(element.id);
        changed = true;
      }
  }
  return [...ids]
    .map((id) => elements.get(id))
    .filter((e): e is Element => !!e && e.shape_type !== "connector");
}
function nearestPort(element: Element, point: Point): string {
  if (element.shape_type === "uml.lifeline")
    return (
      "time:" +
      Math.max(
        0.2,
        Math.min(1, (point.y - element.geometry.y) / element.geometry.height),
      ).toFixed(3)
    );
  const ports = [
    "left",
    "right",
    "top",
    "bottom",
    ...element.structure.members.flatMap((member) => [
      "left:" + member.id,
      "right:" + member.id,
    ]),
  ];
  return ports.sort((a, b) => {
    const ap = portPosition(element, a),
      bp = portPosition(element, b);
    return (
      Math.hypot(ap.x - point.x, ap.y - point.y) -
      Math.hypot(bp.x - point.x, bp.y - point.y)
    );
  })[0];
}
export function BoardCanvas(props: Props) {
  const container = useRef<HTMLDivElement>(null),
    live = useRef(props);
  live.current = props;
  const gesture = useRef<{
    kind: "pan" | "move" | "draw" | "select";
    start: Point;
    screen: Point;
    camera: Camera;
    elements: Element[];
    points: Point[];
  } | null>(null);
  const connect = useRef<{ element: Element; port: string } | null>(null);
  const [editing, setEditing] = useState<Element | null>(null),
    [text, setText] = useState("");
  const [box, setBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const space = useRef(false),
    clipboard = useRef<Element[]>([]);
  useEffect(() => {
    const renderer = new BoardRenderer(
      container.current!,
      {
        down(event) {
          const p = live.current;
          container.current?.focus();
          const hit = event.id ? p.elements.get(event.id) : null;
          if (p.tool === "pan" || space.current || event.event.button === 1) {
            gesture.current = {
              kind: "pan",
              start: event.point,
              screen: event.screen,
              camera: p.camera,
              elements: [],
              points: [],
            };
            return;
          }
          if (event.event.button !== 0) return;
          if (p.tool === "connect" && !p.readOnly) {
            if (!hit || hit.shape_type === "connector") return;
            const port = nearestPort(hit, event.point);
            if (!connect.current) {
              connect.current = { element: hit, port };
              p.onSelection(new Set([hit.id]));
            } else {
              const edge = makeElement("connector", p.pageID, 0, 0),
                start = connect.current;
              edge.structure.start = {
                element_id: start.element.id,
                port: start.port,
                ...portPosition(start.element, start.port),
              };
              edge.structure.end = {
                element_id: hit.id,
                port,
                ...portPosition(hit, port),
              };
              edge.structure.order = p.elements.size;
              connect.current = null;
              void p
                .submit([{ type: "elements.create", elements: [edge] }])
                .catch(p.onError);
              p.onSelection(new Set([edge.id]));
              p.onTool("select");
            }
            return;
          }
          if (p.tool === "draw" && !p.readOnly) {
            const element = makeElement(
              "basic.line",
              p.pageID,
              event.point.x,
              event.point.y,
            );
            element.text = "";
            element.style.fill = "transparent";
            gesture.current = {
              kind: "draw",
              start: event.point,
              screen: event.screen,
              camera: p.camera,
              elements: [element],
              points: [event.point],
            };
            return;
          }
          if (!["select", "pan", "connect"].includes(p.tool) && !p.readOnly) {
            const element = makeElement(
              p.tool,
              p.pageID,
              event.point.x,
              event.point.y,
            );
            element.structure.order = p.elements.size;
            void p
              .submit([{ type: "elements.create", elements: [element] }])
              .catch(p.onError);
            p.onSelection(new Set([element.id]));
            p.onTool("select");
            return;
          }
          if (hit) {
            const selection = new Set(p.selection);
            if (event.event.shiftKey) {
              if (selection.has(hit.id)) selection.delete(hit.id);
              else selection.add(hit.id);
            } else if (!selection.has(hit.id)) {
              selection.clear();
              selection.add(hit.id);
            }
            p.onSelection(selection);
            if (!p.readOnly)
              gesture.current = {
                kind: "move",
                start: event.point,
                screen: event.screen,
                camera: p.camera,
                elements: descendants(p.elements, selection),
                points: [],
              };
          } else {
            if (!event.event.shiftKey) p.onSelection(new Set());
            gesture.current = {
              kind: "select",
              start: event.point,
              screen: event.screen,
              camera: p.camera,
              elements: [],
              points: [],
            };
          }
        },
        move(event) {
          const g = gesture.current,
            p = live.current;
          if (!g) return;
          if (g.kind === "pan") {
            p.onCamera({
              ...g.camera,
              x: g.camera.x + event.screen.x - g.screen.x,
              y: g.camera.y + event.screen.y - g.screen.y,
            });
            return;
          }
          if (g.kind === "move") {
            const dx = Math.round((event.point.x - g.start.x) / 4) * 4,
              dy = Math.round((event.point.y - g.start.y) / 4) * 4;
            renderer.setPreview(
              g.elements.map((element) => ({
                ...element,
                geometry: {
                  ...element.geometry,
                  x: element.geometry.x + dx,
                  y: element.geometry.y + dy,
                },
              })),
            );
            return;
          }
          if (g.kind === "select") {
            setBox({
              x: Math.min(g.screen.x, event.screen.x),
              y: Math.min(g.screen.y, event.screen.y),
              width: Math.abs(event.screen.x - g.screen.x),
              height: Math.abs(event.screen.y - g.screen.y),
            });
            return;
          }
          if (g.kind === "draw") {
            if (
              g.points.length < 20000 &&
              Math.hypot(
                event.point.x - g.points.at(-1)!.x,
                event.point.y - g.points.at(-1)!.y,
              ) > 2
            )
              g.points.push(event.point);
            renderer.setPreview([stroke(g.elements[0], g.points)]);
          }
        },
        up(event) {
          const g = gesture.current,
            p = live.current;
          gesture.current = null;
          if (event.event.type === "pointercancel") {
            renderer.clearPreview();
            setBox(null);
            return;
          }
          if (!g) return;
          renderer.clearPreview();
          if (g.kind === "move") {
            const dx = Math.round((event.point.x - g.start.x) / 4) * 4,
              dy = Math.round((event.point.y - g.start.y) / 4) * 4;
            if (dx || dy)
              void p
                .submit([
                  {
                    type: "elements.update",
                    patches: g.elements.map((e) =>
                      elementPatch(e, {
                        geometry: {
                          ...e.geometry,
                          x: e.geometry.x + dx,
                          y: e.geometry.y + dy,
                        },
                      }),
                    ),
                  },
                ])
                .catch(p.onError);
          }
          if (g.kind === "draw" && g.points.length > 1) {
            const e = stroke(g.elements[0], g.points);
            void p
              .submit([{ type: "elements.create", elements: [e] }])
              .catch(p.onError);
            p.onSelection(new Set([e.id]));
          }
          if (g.kind === "select") {
            const bounds = {
              x: Math.min(g.start.x, event.point.x),
              y: Math.min(g.start.y, event.point.y),
              width: Math.abs(g.start.x - event.point.x),
              height: Math.abs(g.start.y - event.point.y),
            };
            if (bounds.width > 3 || bounds.height > 3) {
              const ids = event.event.shiftKey
                ? new Set(p.selection)
                : new Set<string>();
              for (const element of p.elements.values()) {
                const b = elementBounds(element, p.elements);
                if (
                  b.x >= bounds.x &&
                  b.y >= bounds.y &&
                  b.x + b.width <= bounds.x + bounds.width &&
                  b.y + b.height <= bounds.y + bounds.height
                )
                  ids.add(element.id);
              }
              p.onSelection(ids);
            }
            setBox(null);
          }
        },
        doubleClick(id) {
          const e = live.current.elements.get(id);
          if (!e || live.current.readOnly) return;
          setEditing(e);
          setText(e.text);
        },
        zoom: (camera) => live.current.onCamera(camera),
      },
      (id) =>
        live.current.resolveImage
          ? live.current.resolveImage(id)
          : Promise.reject(new Error("图片未准备好。")),
    );
    props.rendererRef.current = renderer;
    renderer.setCamera(live.current.camera);
    renderer.setElements(live.current.elements);
    return () => {
      renderer.destroy();
      props.rendererRef.current = null;
    };
  }, [props.pageID]);
  useEffect(
    () => props.rendererRef.current?.setElements(props.elements),
    [props.elements, props.rendererRef],
  );
  useEffect(
    () => props.rendererRef.current?.setSelection(props.selection),
    [props.selection, props.rendererRef],
  );
  useEffect(
    () => props.rendererRef.current?.setCamera(props.camera),
    [props.camera, props.rendererRef],
  );
  useEffect(() => {
    if (props.readOnly) {
      gesture.current = null;
      connect.current = null;
      setEditing(null);
      setBox(null);
      props.rendererRef.current?.clearPreview();
    }
  }, [props.readOnly]);
  function saveText() {
    if (!editing || props.readOnly) return;
    const original = editing;
    setEditing(null);
    if (text !== original.text)
      void props
        .submit([
          {
            type: "elements.update",
            patches: [elementPatch(original, { text })],
          },
        ])
        .catch(props.onError);
  }
  async function paste() {
    const p = live.current;
    let elements = clipboard.current;
    try {
      const raw = await navigator.clipboard.readText();
      if (raw.length > 1024 * 1024) throw new Error("剪贴板内容过大。");
      const parsed = JSON.parse(raw);
      if (
        parsed.type === "orbis-board" &&
        parsed.schema_version === 1 &&
        Array.isArray(parsed.elements)
      )
        elements = elementSchema.array().max(500).parse(parsed.elements);
    } catch {}
    if (!elements.length) return;
    const copies = cloneElements(elements, p.pageID);
    await p.submit([{ type: "elements.create", elements: copies }]);
    p.onSelection(new Set(copies.map((e) => e.id)));
  }
  return (
    <div
      className={"board-canvas " + (props.tool === "pan" ? "is-panning" : "")}
      ref={container}
      tabIndex={0}
      role="application"
      aria-label="画板编辑区域"
      onKeyDown={(event) => {
        if (
          event.nativeEvent.isComposing ||
          (event.target instanceof HTMLElement &&
            event.target.closest("input,textarea,[contenteditable=true]"))
        )
          return;
        const command = event.metaKey || event.ctrlKey;
        if (event.code === "Space") {
          event.preventDefault();
          space.current = true;
          return;
        }
        if (event.key === "Escape") {
          connect.current = null;
          gesture.current = null;
          props.rendererRef.current?.clearPreview();
          setBox(null);
          props.onTool("select");
          props.onSelection(new Set());
          return;
        }
        if (command && event.key.toLowerCase() === "a") {
          event.preventDefault();
          props.onSelection(new Set(props.elements.keys()));
          return;
        }
        if (props.readOnly) return;
        const selected =
          props.selection.size === 1
            ? props.elements.get([...props.selection][0])
            : undefined;
        if (
          !command &&
          selected?.shape_type.startsWith("mindmap.") &&
          ["Tab", "Enter"].includes(event.key)
        ) {
          event.preventDefault();
          const result = appendTopic(
            selected,
            props.elements,
            event.key === "Enter",
          );
          void props
            .submit(result.commands)
            .then(() => props.onSelection(new Set([result.id])))
            .catch(props.onError);
          return;
        }
        if (event.key === "Enter" && selected) {
          event.preventDefault();
          setEditing(selected);
          setText(selected.text);
          return;
        }
        if (command && event.key.toLowerCase() === "z") {
          event.preventDefault();
          event.shiftKey ? props.onRedo() : props.onUndo();
          return;
        }
        if (command && event.key.toLowerCase() === "y") {
          event.preventDefault();
          props.onRedo();
          return;
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          const targets = [...props.selection]
            .map((id) => props.elements.get(id))
            .filter((e): e is Element => !!e)
            .map((e) => ({ id: e.id, version: e.version }));
          if (!targets.length) return;
          void props
            .submit([
              {
                type: "elements.delete",
                targets,
              },
            ])
            .catch(props.onError);
          return;
        }
        if (command && event.key.toLowerCase() === "c") {
          event.preventDefault();
          try {
            clipboard.current = selectionForCopy(
              props.elements,
              props.selection,
            );
          } catch (error) {
            props.onError(error);
            return;
          }
          clipboard.current = clipboard.current.map((original) => {
            const e = structuredClone(original);
            for (const endpoint of [e.structure.start, e.structure.end]) {
              if (endpoint?.element_id) {
                const target = props.elements.get(endpoint.element_id);
                if (target)
                  Object.assign(endpoint, portPosition(target, endpoint.port));
              }
            }
            return e;
          });
          void navigator.clipboard
            .writeText(
              JSON.stringify({
                type: "orbis-board",
                schema_version: 1,
                elements: clipboard.current,
              }),
            )
            .catch(props.onError);
          return;
        }
        if (command && event.key.toLowerCase() === "v") {
          event.preventDefault();
          void paste().catch(props.onError);
          return;
        }
        if (
          ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
            event.key,
          )
        ) {
          event.preventDefault();
          const movable = descendants(props.elements, props.selection);
          if (!movable.length) return;
          const step = event.shiftKey ? 10 : 1,
            dx =
              event.key === "ArrowLeft"
                ? -step
                : event.key === "ArrowRight"
                  ? step
                  : 0,
            dy =
              event.key === "ArrowUp"
                ? -step
                : event.key === "ArrowDown"
                  ? step
                  : 0;
          void props
            .submit([
              {
                type: "elements.update",
                patches: movable.map((e) =>
                  elementPatch(e, {
                    geometry: {
                      ...e.geometry,
                      x: e.geometry.x + dx,
                      y: e.geometry.y + dy,
                    },
                  }),
                ),
              },
            ])
            .catch(props.onError);
        }
      }}
      onKeyUp={(event) => {
        if (event.code === "Space") space.current = false;
      }}
      onBlur={() => {
        space.current = false;
      }}
    >
      {box ? (
        <div
          className="board-selection-box"
          style={{
            left: box.x,
            top: box.y,
            width: box.width,
            height: box.height,
          }}
        />
      ) : null}
      {editing ? (
        <textarea
          autoFocus
          className="board-inline-text"
          aria-label="编辑图元文字"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={saveText}
          style={{
            left: editing.geometry.x * props.camera.zoom + props.camera.x,
            top: editing.geometry.y * props.camera.zoom + props.camera.y,
            width: Math.max(160, editing.geometry.width * props.camera.zoom),
            height: Math.max(80, editing.geometry.height * props.camera.zoom),
            fontSize: editing.style.font_size * props.camera.zoom,
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(null);
            } else if (
              (event.ctrlKey || event.metaKey) &&
              event.key === "Enter"
            ) {
              event.preventDefault();
              saveText();
            }
          }}
        />
      ) : null}
      {!editing && props.selection.size === 1 && !props.readOnly ? (
        <ResizeHandle
          elements={props.elements}
          element={props.elements.get([...props.selection][0])}
          camera={props.camera}
          renderer={props.rendererRef.current}
          submit={props.submit}
          onError={props.onError}
        />
      ) : null}
    </div>
  );
}
function stroke(element: Element, points: Point[]): Element {
  const bounds = unionBounds(
    points.map((p) => ({ ...p, width: 0, height: 0 })),
  );
  const width = Math.max(1, bounds.width),
    height = Math.max(1, bounds.height);
  return {
    ...element,
    geometry: { ...element.geometry, ...bounds, width, height },
    structure: {
      ...element.structure,
      points: points.map((p) => ({
        x: ((p.x - bounds.x) / width) * 100,
        y: ((p.y - bounds.y) / height) * 100,
      })),
    },
  };
}
function ResizeHandle({
  elements,
  element,
  camera,
  renderer,
  submit,
  onError,
}: {
  elements: Map<string, Element>;
  element?: Element;
  camera: Camera;
  renderer: BoardRenderer | null;
  submit: Props["submit"];
  onError: Props["onError"];
}) {
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);
  if (!element || element.shape_type === "connector") return null;
  return (
    <button
      className="board-resize-handle"
      aria-label="调整图元大小"
      style={{
        left:
          (element.geometry.x + element.geometry.width) * camera.zoom +
          camera.x -
          5,
        top:
          (element.geometry.y + element.geometry.height) * camera.zoom +
          camera.y -
          5,
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        cleanup.current();
        const x = event.clientX,
          y = event.clientY;
        let current = element;
        const move = (e: PointerEvent) => {
          current = {
            ...element,
            geometry: {
              ...element.geometry,
              width: Math.max(
                24,
                element.geometry.width + (e.clientX - x) / camera.zoom,
              ),
              height: Math.max(
                24,
                element.geometry.height + (e.clientY - y) / camera.zoom,
              ),
            },
          };
          try {
            const patches = transformBranch(
              elements,
              element,
              current.geometry,
            );
            renderer?.setPreview(
              patches.map((patch) => ({
                ...elements.get(patch.id)!,
                ...(patch.geometry ? { geometry: patch.geometry } : {}),
                ...(patch.structure ? { structure: patch.structure } : {}),
              })),
            );
          } catch (error) {
            cleanup.current();
            renderer?.clearPreview();
            onError(error);
          }
        };
        const done = () => {
          cleanup.current();
          renderer?.clearPreview();
          void submit([
            {
              type: "elements.update",
              patches: transformBranch(elements, element, current.geometry),
            },
          ]).catch(onError);
        };
        const cancel = () => cleanup.current();
        cleanup.current = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", done);
          window.removeEventListener("pointercancel", cancel);
          window.removeEventListener("blur", cancel);
          renderer?.clearPreview();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", done, { once: true });
        window.addEventListener("pointercancel", cancel, { once: true });
        window.addEventListener("blur", cancel, { once: true });
      }}
    />
  );
}
