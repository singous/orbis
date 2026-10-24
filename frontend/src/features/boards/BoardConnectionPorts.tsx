import { Plus } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Tooltip } from "../../shared/ui/Tooltip";
import { connectionEndpoint, connectionPorts, findConnectionPort, type ConnectionPort } from "./connection-ports";
import { hiddenElements } from "./mindmap";
import { makeElement, type Command, type Element, type Point } from "./model";
import type { BoardRenderer, Camera } from "./renderer";

type Props = {
  elements: Map<string, Element>;
  pageID: string;
  camera: Camera;
  hoveredID: string | null;
  selection: Set<string>;
  enabled: boolean;
  viewport: RefObject<HTMLDivElement | null>;
  renderer: RefObject<BoardRenderer | null>;
  submit: (commands: Command[]) => Promise<void>;
  onSelection: (ids: Set<string>) => void;
  onTool: (tool: string) => void;
  onError: (error: unknown) => void;
};
type Draft = {
  edge: Element;
  source: ConnectionPort;
  target: ConnectionPort | null;
  point: Point;
  pointerID: number | null;
  capture: HTMLElement | null;
  renderer: BoardRenderer | null;
  owner: number;
};

/** 连接点只持有本次手势；真正的图元与撤销历史仍由画板会话提交。 */
export function BoardConnectionPorts(props: Props) {
  const live = useRef(props);
  live.current = props;
  const active = useRef<Draft | null>(null);
  const queuedPreview = useRef<{ renderer: BoardRenderer | null; owner: number } | null>(null);
  const owner = useRef(0);
  const mounted = useRef(false);
  const [view, setView] = useState<{ source: ConnectionPort; target: ConnectionPort | null } | null>(null);

  function validPort(port: ConnectionPort): ConnectionPort | null {
    const p = live.current, element = p.elements.get(port.elementID);
    if (!element || element.page_id !== p.pageID || element.style.opacity <= 0 || hiddenElements(p.elements).has(element.id)) return null;
    return connectionPorts(element).find(candidate => candidate.port === port.port) ?? null;
  }
  function release(draft: Draft) {
    if (draft.pointerID === null || !draft.capture) return;
    try { draft.capture.releasePointerCapture?.(draft.pointerID); } catch { /* 浏览器可能已在 pointerup 时释放捕获。 */ }
  }
  function cancel() {
    const draft = active.current;
    active.current = null;
    owner.current++;
    if (mounted.current) setView(null);
    draft?.renderer?.clearPreview();
    queuedPreview.current?.renderer?.clearPreview();
    queuedPreview.current = null;
    if (draft) release(draft);
  }
  function worldPoint(event: { clientX: number; clientY: number }): Point {
    const p = live.current, rect = p.viewport.current?.getBoundingClientRect();
    const screen = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    return p.renderer.current?.worldPoint(screen) ?? { x: (screen.x - p.camera.x) / p.camera.zoom, y: (screen.y - p.camera.y) / p.camera.zoom };
  }
  function preview(draft: Draft, point: Point) {
    const p = live.current, source = validPort(draft.source);
    if (!p.enabled || !source) { cancel(); return; }
    draft.source = source;
    draft.point = point;
    draft.target = findConnectionPort(p.elements, point, p.camera.zoom, source.elementID);
    draft.edge = { ...draft.edge, structure: { ...draft.edge.structure, start: connectionEndpoint(source), end: draft.target ? connectionEndpoint(draft.target) : { element_id: null, port: "", ...point } } };
    draft.renderer?.setPreview([draft.edge]);
    setView({ source, target: draft.target });
  }
  function finish(draft: Draft, target: ConnectionPort | null) {
    const p = live.current, source = validPort(draft.source), end = target && validPort(target);
    if (!p.enabled || !source || !end || source.elementID === end.elementID) { cancel(); return; }
    active.current = null;
    setView(null);
    release(draft);
    const edge: Element = { ...draft.edge, structure: { ...draft.edge.structure, order: p.elements.size, start: connectionEndpoint(source), end: connectionEndpoint(end) } };
    draft.renderer?.setPreview([edge]);
    queuedPreview.current = { renderer: draft.renderer, owner: draft.owner };
    void p.submit([{ type: "elements.create", elements: [edge] }]).then(() => {
      if (!mounted.current || owner.current !== draft.owner) return;
      live.current.onSelection(new Set([edge.id]));
      live.current.onTool("select");
    }).catch(error => { if (mounted.current) live.current.onError(error); }).finally(() => {
      if (mounted.current && owner.current === draft.owner) {
        draft.renderer?.clearPreview();
        queuedPreview.current = null;
      }
    });
  }
  function begin(port: ConnectionPort, pointerID: number | null) {
    const p = live.current, source = validPort(port);
    if (!p.enabled || !source) return;
    if (active.current?.pointerID === null) { finish(active.current, source); return; }
    cancel();
    const edge = makeElement("connector", p.pageID, 0, 0);
    const capture = pointerID === null ? null : p.renderer.current?.stage.getContent() ?? null;
    const draft: Draft = { edge, source, point: source.point, target: null, pointerID, capture, renderer: p.renderer.current, owner: ++owner.current };
    active.current = draft;
    if (pointerID !== null) p.viewport.current?.focus();
    if (pointerID !== null) { try { capture?.setPointerCapture?.(pointerID); } catch { /* 测试或已结束的指针不允许原生捕获。 */ } }
    preview(draft, source.point);
  }

  useEffect(() => {
    mounted.current = true;
    setView(null);
    const move = (event: PointerEvent) => {
      const draft = active.current;
      if (draft && draft.pointerID === event.pointerId) preview(draft, worldPoint(event));
    };
    const up = (event: PointerEvent) => {
      const draft = active.current;
      if (!draft || draft.pointerID !== event.pointerId) return;
      const point = worldPoint(event), p = live.current;
      finish(draft, findConnectionPort(p.elements, point, p.camera.zoom, draft.source.elementID));
    };
    const cancelled = (event: PointerEvent) => { if (active.current?.pointerID === event.pointerId) cancel(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && active.current) { event.preventDefault(); cancel(); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelled);
    window.addEventListener("lostpointercapture", cancelled, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      mounted.current = false;
      cancel();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelled);
      window.removeEventListener("lostpointercapture", cancelled, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [props.enabled, props.pageID]);

  useEffect(() => {
    const draft = active.current;
    if (draft) preview(draft, draft.point);
  }, [props.elements, props.camera]);

  if (!props.enabled) return null;
  const hidden = hiddenElements(props.elements);
  const ids = new Set([props.hoveredID, view?.source.elementID, view?.target?.elementID]);
  if (props.selection.size === 1) ids.add([...props.selection][0]);
  const ports = [...ids].flatMap(id => {
    const element = id ? props.elements.get(id) : null;
    return element && (view || !element.shape_type.startsWith("mindmap.")) && element.page_id === props.pageID && element.style.opacity > 0 && !hidden.has(element.id) ? connectionPorts(element) : [];
  });
  return <div className="board-connection-ports" aria-label="图元连接点">
    {ports.map(port => {
      const element = props.elements.get(port.elementID)!;
      const selected = [view?.source, view?.target].some(candidate => candidate?.elementID === port.elementID && candidate.port === port.port);
      return <Tooltip key={`${port.elementID}:${port.port}`} label={view ? "拖拽到此处连接；按 Esc 取消" : "拖拽连接到其他图形"}>
        <ActionButton className={`board-connection-port${selected ? " is-active" : ""}`} aria-label={`${element.text || "图形"} ${port.label}`} aria-pressed={selected} style={{ left: port.point.x * props.camera.zoom + props.camera.x, top: port.point.y * props.camera.zoom + props.camera.y }} onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          begin(port, event.pointerId);
        }} onPress={event => { if (event.pointerType === "keyboard" || event.pointerType === "virtual") begin(port, null); }}>
          <span className="board-connection-port-mark" aria-hidden="true"><Plus size={10} strokeWidth={2.5} /></span>
        </ActionButton>
      </Tooltip>;
    })}
  </div>;
}
