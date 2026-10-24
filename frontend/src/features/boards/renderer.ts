export const MIN_ZOOM = 0.000001;
export const MAX_ZOOM = 4;
const FIT_MARGIN = 60;
const MAX_FIT_ZOOM = 1.25;
import { hiddenElements } from "./mindmap";
import Konva from "konva";
import { iconImage } from "./icons";
import type { KonvaEventObject } from "konva/lib/Node";
import { DEFAULT_STYLE, SHAPES, type Element, type Point } from "./model";
import { boardElementStyle } from "./board-appearance";
import {
  CANVAS_FONT,
  MEMBER_HEADER_HEIGHT,
  MEMBER_ROW_HEIGHT,
  SpatialIndex,
  connectorPath,
  connectorPoints,
  elementBounds,
  elementShapePath,
  isContainer,
  isMemberShape,
  isMindmapBranch,
  unionBounds,
  type Bounds,
} from "./geometry";

export type Camera = { x: number; y: number; zoom: number };
export type CanvasPointer = {
  id: string | null;
  point: Point;
  screen: Point;
  event: PointerEvent;
};
export type CanvasEvents = {
  down: (event: CanvasPointer) => void;
  move: (event: CanvasPointer) => void;
  up: (event: CanvasPointer) => void;
  doubleClick: (id: string, point: Point) => void;
  zoom: (camera: Camera) => void;
};
const VIEWPORT_MARGIN = 180,
  DETAIL_ZOOM = 0.25,
  OVERVIEW_MAX_PIXELS = 2048;
function drawNode(
  element: Element,
  elements: ReadonlyMap<string, Element>,
  detailed: boolean,
  resolveImage?: (id: string) => Promise<HTMLCanvasElement>,
  canvasTextColor = DEFAULT_STYLE.text_color,
): Konva.Group {
  const group = new Konva.Group({ id: element.id, name: "board-element" });
  const { geometry: g, structure } = element;
  const s = boardElementStyle(element, canvasTextColor);
  const primitive = SHAPES.get(element.shape_type)?.primitive ?? "rect";
  const line = element.shape_type === "connector";
  const fill =
    primitive === "initial" || primitive === "fork" ? s.stroke : s.fill;
  const props = {
    fill,
    stroke: s.stroke,
    strokeWidth: s.stroke_width,
    strokeScaleEnabled: false,
    dash: s.dashed ? [6, 4] : undefined,
    opacity: s.opacity,
    perfectDrawEnabled: false,
    lineJoin: "round" as const,
    lineCap: "round" as const,
  };
  if (line) {
    group.add(
      new Konva.Path({
        data: connectorPath(element, elements),
        ...props,
        fill: undefined,
        hitStrokeWidth: 12,
      }),
    );
    const points = connectorPoints(element, elements);
    for (const [marker, tip, previous] of [
      [structure.end_marker, points.at(-1)!, points.at(-2)!],
      [structure.start_marker, points[0], points[1]],
    ] as const) {
      if (marker === "none") continue;
      const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
      const mark = new Konva.Group({
        x: tip.x,
        y: tip.y,
        rotation: (angle * 180) / Math.PI,
      });
      if (marker === "circle")
        mark.add(
          new Konva.Circle({ x: -5, radius: 5, ...props, fill: s.fill }),
        );
      else if (marker === "one")
        mark.add(new Konva.Line({ points: [-8, -7, -8, 7], ...props }));
      else if (marker === "many")
        mark.add(
          new Konva.Line({
            points: [0, -8, -12, 0, 0, 8, -12, 0, 0, 0],
            ...props,
            fill: undefined,
          }),
        );
      else
        mark.add(
          new Konva.Line({
            points:
              marker === "diamond"
                ? [0, 0, -9, -5, -18, 0, -9, 5]
                : [0, 0, -11, -5, -11, 5],
            closed: true,
            ...props,
            fill: marker === "triangle" ? s.fill : s.stroke,
          }),
        );
      group.add(mark);
    }
    if (element.text && detailed) {
      const center = points[Math.floor(points.length / 2)];
      group.add(
        new Konva.Text({
          x: center.x - 70,
          y: center.y - 22,
          width: 140,
          text: element.text,
          fontFamily: CANVAS_FONT,
          fontSize: s.font_size,
          align: "center",
          fill: s.text_color,
          padding: 4,
        }),
      );
    }
    return group;
  }
  group.position({ x: g.x + g.width / 2, y: g.y + g.height / 2 });
  group.offset({ x: g.width / 2, y: g.height / 2 });
  group.rotation((g.rotation_rad * 180) / Math.PI);
  // 透明分支的文字不参与命中，保留完整点击区域供悬浮、拖动和编辑使用。
  if (isMindmapBranch(element))
    group.add(new Konva.Rect({
      width: g.width,
      height: g.height,
      cornerRadius: 6,
      fill: s.fill,
      opacity: s.opacity,
      name: "mindmap-branch-hit-area",
    }));
  const path =
    primitive === "line" && structure.points.length
      ? structure.points
          .map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`)
          .join(" ")
      : elementShapePath(element);
  if (path)
    group.add(
      new Konva.Path({
        data: path,
        scaleX: g.width / 100,
        scaleY: g.height / 100,
        ...props,
        fill: isMindmapBranch(element) || ["actor", "annotation", "line", "search"].includes(primitive)
          ? undefined
          : fill,
      }),
    );
  else
    group.add(
      new Konva.Rect({
        width: g.width,
        height: g.height,
        fill: primitive === "image" ? "#e2e8f0" : "transparent",
        stroke: primitive === "image" ? s.stroke : undefined,
      }),
    );
  if (primitive === "image" && structure.asset_id && resolveImage && detailed) {
    void resolveImage(structure.asset_id)
      .then((image) => {
        if (!group.getStage()) return;
        const scale = Math.min(g.width / image.width, g.height / image.height),
          width = image.width * scale,
          height = image.height * scale;
        group.add(
          new Konva.Image({
            image,
            x: (g.width - width) / 2,
            y: (g.height - height) / 2,
            width,
            height,
            listening: false,
          }),
        );
        group.getLayer()?.batchDraw();
      })
      .catch(() => {
        if (group.getStage()) {
          group.add(
            new Konva.Text({
              text: "图片暂时不可用",
              x: 8,
              y: 8,
              fontSize: 12,
              fill: "#64748b",
              listening: false,
            }),
          );
          group.getLayer()?.batchDraw();
        }
      });
  }
  if (structure.icon_id && detailed) {
    const size = Math.min(36, g.height - 16, g.width - 16);
    void iconImage(structure.icon_id, s.text_color)
      .then((image) => {
        if (!group.getStage()) return;
        group.add(
          new Konva.Image({
            image,
            x: 10,
            y: 10,
            width: size,
            height: size,
            listening: false,
          }),
        );
        group.getLayer()?.batchDraw();
      })
      .catch(() => {});
  }
  if (primitive === "final")
    group.add(
      new Konva.Ellipse({
        x: g.width / 2,
        y: g.height / 2,
        radiusX: g.width * 0.3,
        radiusY: g.height * 0.3,
        fill: s.stroke,
      }),
    );
  if (isMemberShape(element)) {
    group.add(
      new Konva.Line({
        points: [0, MEMBER_HEADER_HEIGHT, g.width, MEMBER_HEADER_HEIGHT],
        ...props,
        fill: undefined,
      }),
    );
    if (detailed)
      structure.members.forEach((member, index) => {
        group.add(
          new Konva.Text({
            x: 12,
            y: MEMBER_HEADER_HEIGHT + index * MEMBER_ROW_HEIGHT + 5,
            width: g.width - 24,
            height: MEMBER_ROW_HEIGHT,
            fontFamily: CANVAS_FONT,
            fontSize: s.font_size,
            fill: s.text_color,
            text: `${member.key === "primary" ? "PK " : member.key === "foreign" ? "FK " : ""}${member.name}${member.type ? " : " + member.type : ""}`,
          }),
        );
      });
  }
  if (["lane", "pool"].includes(primitive))
    group.add(
      new Konva.Line({
        points: [40, 0, 40, g.height],
        ...props,
        fill: undefined,
      }),
    );
  if (["vertical-lane", "phase"].includes(primitive))
    group.add(
      new Konva.Line({
        points: [0, 36, g.width, 36],
        ...props,
        fill: undefined,
      }),
    );
  if (detailed && element.text) {
    const top =
      isContainer(element) ||
      isMemberShape(element) ||
      primitive === "lifeline";
    group.add(
      new Konva.Text({
        x: 10,
        y: top ? 6 : primitive === "actor" ? g.height + 5 : 8,
        width: g.width - 20,
        height: top ? 28 : primitive === "actor" ? 28 : g.height - 16,
        text: primitive === "history" ? "H" : element.text,
        fontFamily: CANVAS_FONT,
        fontSize: s.font_size,
        fill: s.text_color,
        fontStyle: s.bold || top ? "bold" : "normal",
        align: top ? "left" : s.align,
        verticalAlign: "middle",
        wrap: "char",
        ellipsis: true,
        listening: false,
      }),
    );
  }
  return group;
}

/** Owns the canvas and all its listeners. UI and persisted state remain outside Konva. */
export class BoardRenderer {
  private hidden = new Set<string>();
  readonly stage: Konva.Stage;
  private content = new Konva.Layer();
  private overlay = new Konva.Layer({ listening: false });
  private world = new Konva.Group();
  private adornments = new Konva.Group();
  private elements = new Map<string, Element>();
  private rendered = new Map<string, Element>();
  private incident = new Map<string, Set<string>>();
  private index = new SpatialIndex();
  private nodes = new Map<
    string,
    { node: Konva.Group; element: Element; detailed: boolean }
  >();
  private selection = new Set<string>();
  private canvasTextColor = DEFAULT_STYLE.text_color;
  private invalidated = new Set<string>();
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private frame = 0;
  private qualityTimer: ReturnType<typeof setTimeout> | null = null;
  private resolution = Math.min(window.devicePixelRatio || 1, 2);
  private renderedResolution: number | null = null;
  private destroyed = false;
  private preview = new Map<string, Element>();
  private overview: Konva.Image | null = null;
  private overviewDirty = true;
  private resizeObserver: ResizeObserver;
  constructor(
    container: HTMLDivElement,
    events: CanvasEvents,
    private resolveImage?: (id: string) => Promise<HTMLCanvasElement>,
  ) {
    this.stage = new Konva.Stage({
      container,
      width: container.clientWidth,
      height: container.clientHeight,
    });
    this.content.add(this.world);
    this.overlay.add(this.adornments);
    this.stage.add(this.content, this.overlay);
    this.resizeObserver = new ResizeObserver(() => {
      this.stage.size({
        width: container.clientWidth,
        height: container.clientHeight,
      });
      this.schedule();
    });
    this.resizeObserver.observe(container);
    const pointer = (event: KonvaEventObject<PointerEvent>): CanvasPointer => {
      const screen = this.stage.getPointerPosition() ?? { x: 0, y: 0 };
      const target = event.target.findAncestor(".board-element", true);
      const point = this.worldPoint(screen);
      return {
        id:
          target?.id() ??
          (this.camera.zoom < DETAIL_ZOOM ? this.pickOverview(point) : null),
        screen,
        point,
        event: event.evt,
      };
    };
    this.stage.on("pointerdown", (event) => {
      this.stage.getContent().setPointerCapture?.(event.evt.pointerId);
      events.down(pointer(event));
    });
    this.stage.on("pointermove", (event) => events.move(pointer(event)));
    this.stage.on("pointerup pointercancel", (event) =>
      events.up(pointer(event)),
    );
    this.stage.on("dblclick dbltap", (event) => {
      const target = event.target.findAncestor(".board-element", true);
      if (target)
        events.doubleClick(
          target.id(),
          this.worldPoint(this.stage.getPointerPosition()!),
        );
    });
    this.stage.on("wheel", (event) => {
      event.evt.preventDefault();
      const screen = this.stage.getPointerPosition() ?? { x: 0, y: 0 };
      if (event.evt.ctrlKey || event.evt.metaKey) {
        const point = this.worldPoint(screen),
          zoom = Math.max(
            MIN_ZOOM,
            Math.min(
              MAX_ZOOM,
              this.camera.zoom * Math.exp(-event.evt.deltaY * 0.006),
            ),
          );
        events.zoom({
          x: screen.x - point.x * zoom,
          y: screen.y - point.y * zoom,
          zoom,
        });
      } else
        events.zoom({
          ...this.camera,
          x: this.camera.x - event.evt.deltaX,
          y: this.camera.y - event.evt.deltaY,
        });
    });
  }
  worldPoint(screen: Point): Point {
    return {
      x: (screen.x - this.camera.x) / this.camera.zoom,
      y: (screen.y - this.camera.y) / this.camera.zoom,
    };
  }
  setCamera(camera: Camera) {
    this.motionQuality();
    this.camera = camera;
    for (const group of [this.world, this.adornments]) {
      group.position(camera);
      group.scale({ x: camera.zoom, y: camera.zoom });
    }
    this.schedule();
  }
  setElements(elements: Map<string, Element>) {
    const changed = new Set<string>();
    for (const [id, element] of elements)
      if (this.elements.get(id) !== element) changed.add(id);
    for (const id of this.elements.keys())
      if (!elements.has(id)) {
        this.index.delete(id);
        changed.add(id);
      }
    this.elements = elements;
    this.hidden = hiddenElements(elements);
    // 外部刷新不能丢掉正在拖动的草稿；草稿由交互所有者在提交或取消时显式清除。
    this.rendered = new Map([...elements, ...this.preview]);
    this.overviewDirty = true;
    this.incident.clear();
    for (const [id, element] of elements)
      if (element.shape_type === "connector") {
        for (const endpoint of [element.structure.start, element.structure.end])
          if (endpoint?.element_id) {
            const edges =
              this.incident.get(endpoint.element_id) ?? new Set<string>();
            edges.add(id);
            this.incident.set(endpoint.element_id, edges);
          }
      }
    for (const [id, element] of elements) {
      if (
        changed.has(id) ||
        (element.shape_type === "connector" &&
          (changed.has(element.structure.start?.element_id ?? "") ||
            changed.has(element.structure.end?.element_id ?? "")))
      ) {
        this.index.set(id, elementBounds(element, elements));
        this.invalidated.add(id);
      }
    }
    this.schedule();
  }
  setSelection(selection: Set<string>) {
    this.selection = selection;
    this.schedule();
  }
  setCanvasTextColor(color: string) {
    if (color === this.canvasTextColor) return;
    this.canvasTextColor = color;
    for (const id of this.nodes.keys()) this.invalidated.add(id);
    this.schedule();
  }
  setPreview(elements: Element[]) {
    this.motionQuality();
    this.overviewDirty = true;
    for (const element of elements) {
      this.preview.set(element.id, element);
      this.rendered.set(element.id, element);
    }
    for (const element of elements) {
      this.invalidated.add(element.id);
    }
    for (const element of elements)
      for (const id of this.incident.get(element.id) ?? []) {
        this.invalidated.add(id);
      }
    this.schedule();
  }
  clearPreview() {
    this.overviewDirty = true;
    for (const id of this.preview.keys()) {
      const original = this.elements.get(id);
      if (original) this.rendered.set(id, original);
      else this.rendered.delete(id);
      for (const target of [id, ...(this.incident.get(id) ?? [])]) {
        this.invalidated.add(target);
      }
    }
    this.preview.clear();
    this.schedule();
  }
  fit(bounds: Bounds, rightInset = 0): Camera {
    const width = Math.max(FIT_MARGIN * 2 + 1, this.stage.width() - rightInset);
    const height = Math.max(FIT_MARGIN * 2 + 1, this.stage.height());
    const zoom = Math.max(
      MIN_ZOOM,
      Math.min(
        MAX_FIT_ZOOM,
        (width - FIT_MARGIN * 2) / Math.max(1, bounds.width),
        (height - FIT_MARGIN * 2) / Math.max(1, bounds.height),
      ),
    );
    return {
      x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
      zoom,
    };
  }

  private schedule() {
    if (!this.frame && !this.destroyed)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
  }
  private motionQuality() {
    if (this.qualityTimer) clearTimeout(this.qualityTimer);
    if (this.resolution !== 1) {
      this.resolution = 1;
    }
    this.qualityTimer = setTimeout(() => {
      this.qualityTimer = null;
      if (this.destroyed) return;
      this.resolution = Math.min(window.devicePixelRatio || 1, 2);
      this.schedule();
    }, 160);
  }
  private pickOverview(point: Point): string | null {
    const tolerance = 4 / this.camera.zoom;
    const ids = this.index.query({
      x: point.x - tolerance,
      y: point.y - tolerance,
      width: tolerance * 2,
      height: tolerance * 2,
    });
    return (
      ids
        .map((id) => this.elements.get(id)!)
        .filter((e) => e.shape_type !== "connector")
        .sort(
          (a, b) =>
            Number(isContainer(a)) - Number(isContainer(b)) ||
            b.structure.order - a.structure.order,
        )[0]?.id ?? null
    );
  }
  private drawOverview() {
    if (this.overviewDirty || !this.overview) {
      this.overview?.destroy();
      const scene = this.rendered,
        bounds = unionBounds(
          [...scene.values()].map((e) => elementBounds(e, scene)),
        );
      const scale = Math.min(
        DETAIL_ZOOM,
        OVERVIEW_MAX_PIXELS / Math.max(bounds.width, bounds.height),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(bounds.width * scale) + 4);
      canvas.height = Math.max(1, Math.ceil(bounds.height * scale) + 4);
      const context = canvas.getContext("2d")!;
      context.setTransform(
        scale,
        0,
        0,
        scale,
        -bounds.x * scale + 2,
        -bounds.y * scale + 2,
      );
      const paths = new Map<string, Path2D>();
      const elements = [...scene.values()].sort(
        (a, b) =>
          Number(isContainer(b)) - Number(isContainer(a)) ||
          a.structure.order - b.structure.order,
      );
      for (const element of elements) {
        if (this.hidden.has(element.id)) continue;
        const s = boardElementStyle(element, this.canvasTextColor),
          g = element.geometry;
        context.save();
        context.strokeStyle = s.stroke;
        context.fillStyle = s.fill;
        context.globalAlpha = s.opacity;
        context.lineJoin = "round";
        context.lineCap = "round";
        if (element.shape_type === "connector") {
          context.lineWidth = Math.max(s.stroke_width, 0.7 / scale);
          context.stroke(new Path2D(connectorPath(element, scene)));
        } else {
          const primitive = SHAPES.get(element.shape_type)?.primitive ?? "rect";
          const data = elementShapePath(element);
          if (data) {
            let path = paths.get(element.shape_type);
            if (!path) {
              path = new Path2D(data);
              paths.set(element.shape_type, path);
            }
            context.translate(g.x + g.width / 2, g.y + g.height / 2);
            context.rotate(g.rotation_rad);
            context.translate(-g.width / 2, -g.height / 2);
            if (isMindmapBranch(element) && s.fill !== "transparent") {
              context.beginPath();
              context.roundRect(0, 0, g.width, g.height, 6);
              context.fill();
            }
            context.scale(g.width / 100, g.height / 100);
            context.lineWidth =
              Math.max(s.stroke_width, 0.6 / scale) /
              Math.max(g.width / 100, g.height / 100);
            if (!isMindmapBranch(element) && !["actor", "annotation", "line", "search"].includes(primitive))
              context.fill(path);
            context.stroke(path);
          }
        }
        context.restore();
      }
      this.overview = new Konva.Image({
        image: canvas,
        x: bounds.x - 2 / scale,
        y: bounds.y - 2 / scale,
        width: canvas.width / scale,
        height: canvas.height / scale,
        listening: false,
      });
      this.world.add(this.overview);
      this.overviewDirty = false;
    }
    this.overview.show();
  }
  private draw() {
    // 调整像素比与重建节点必须和实际绘制在同一帧完成，避免拖拽中出现空帧。
    if (this.renderedResolution !== this.resolution) {
      this.content.getCanvas().setPixelRatio(this.resolution);
      this.renderedResolution = this.resolution;
    }
    const { x, y, zoom } = this.camera;
    const viewport = {
      x: (-x - VIEWPORT_MARGIN) / zoom,
      y: (-y - VIEWPORT_MARGIN) / zoom,
      width: (this.stage.width() + VIEWPORT_MARGIN * 2) / zoom,
      height: (this.stage.height() + VIEWPORT_MARGIN * 2) / zoom,
    };
    const detailed = zoom >= DETAIL_ZOOM;
    const visible = detailed
      ? new Set([
          ...this.index.query(viewport),
          ...this.preview.keys(),
          ...[...this.preview.keys()].flatMap((id) => [
            ...(this.incident.get(id) ?? []),
          ]),
        ])
      : new Set<string>();
    const scene = this.rendered;
    for (const id of this.hidden) visible.delete(id);
    for (const [id, entry] of this.nodes)
      if (!visible.has(id) || !scene.has(id)) {
        entry.node.destroy();
        this.nodes.delete(id);
      }
    const sorted = [...visible]
      .map((id) => scene.get(id))
      .filter((e): e is Element => !!e)
      .sort(
        (a, b) =>
          Number(isContainer(b)) - Number(isContainer(a)) ||
          a.structure.order - b.structure.order ||
          a.id.localeCompare(b.id),
      );
    if (!detailed) this.drawOverview();
    else this.overview?.hide();
    sorted.forEach((element, position) => {
      let cached = this.nodes.get(element.id);
      if (
        !cached ||
        cached.element !== element ||
        cached.detailed !== detailed ||
        this.invalidated.has(element.id)
      ) {
        cached?.node.destroy();
        const node = drawNode(element, scene, detailed, this.resolveImage, this.canvasTextColor);
        this.world.add(node);
        cached = { node, element, detailed };
        this.nodes.set(element.id, cached);
      }
      const z = position + (this.overview ? 1 : 0);
      if (cached.node.zIndex() !== z) cached.node.zIndex(z);
    });
    this.invalidated.clear();
    this.adornments.destroyChildren();
    for (const id of this.selection) {
      const element = scene.get(id);
      if (!element) continue;
      const bounds = elementBounds(element, scene);
      this.adornments.add(
        new Konva.Rect({
          ...bounds,
          stroke: "#2563eb",
          strokeWidth: 1 / zoom,
          dash: [4 / zoom, 3 / zoom],
        }),
      );
    }
    this.content.draw();
    this.overlay.draw();
  }
  stats() {
    return {
      visible: this.nodes.size,
      overview: this.camera.zoom < DETAIL_ZOOM,
      total: this.elements.size,
      canvasCount: 2,
    };
  }
  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    if (this.qualityTimer) clearTimeout(this.qualityTimer);
    this.resizeObserver.disconnect();
    this.stage.destroy();
    this.nodes.clear();
    // 场景集合由会话持有；销毁渲染器只解除引用，不能清空调用方的页面快照。
    this.elements = new Map();
  }
}
