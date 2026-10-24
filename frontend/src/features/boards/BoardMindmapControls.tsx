import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Tooltip } from "../../shared/ui/Tooltip";
import { portPosition } from "./geometry";
import { appendTopic, hiddenElements, isMindmapTopic, mindmapDescendants, toggleTopicCollapsed } from "./mindmap";
import type { Command, Element } from "./model";
import type { Camera } from "./renderer";

type Props = {
  elements: Map<string, Element>;
  selection: Set<string>;
  camera: Camera;
  readOnly: boolean;
  hoveredID?: string | null;
  submit: (commands: Command[]) => Promise<void>;
  onSelection: (ids: Set<string>) => void;
  onError: (error: unknown) => void;
};
const CONTROL_OFFSET = 28;

export function BoardMindmapControls(props: Props) {
  const live = useRef(props);
  live.current = props;
  const mounted = useRef(false), owner = useRef(0);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; owner.current++; };
  }, []);
  useEffect(() => { if (props.readOnly) { owner.current++; setPending(null); } }, [props.readOnly]);
  async function submit(node: Element, commands: Command[], selectID?: string) {
    if (live.current.readOnly || !commands.length) return;
    const operation = ++owner.current;
    setPending(node.id);
    try {
      await live.current.submit(commands);
      const current = live.current.elements.get(node.id);
      if (mounted.current && operation === owner.current && !live.current.readOnly && current?.page_id === node.page_id && selectID) live.current.onSelection(new Set([selectID]));
    } catch (error) {
      if (mounted.current && operation === owner.current) live.current.onError(error);
    } finally {
      if (mounted.current && operation === owner.current) setPending(null);
    }
  }
  if (props.readOnly) return null;
  const hidden = hiddenElements(props.elements);
  const selectedID = props.selection.size === 1 ? [...props.selection][0] : null;
  const ids = new Set([props.hoveredID, selectedID]);
  for (const element of props.elements.values()) if (isMindmapTopic(element) && element.structure.collapsed) ids.add(element.id);
  const nodes = [...ids].flatMap(id => {
    const node = id ? props.elements.get(id) : null;
    return node && isMindmapTopic(node) && !hidden.has(node.id) ? [node] : [];
  });
  return <div className="board-mindmap-controls" aria-label="思维导图分支操作">
    {nodes.map(node => {
      const descendants = mindmapDescendants(props.elements, node.id);
      const point = portPosition(node, "right");
      const left = point.x * props.camera.zoom + props.camera.x + CONTROL_OFFSET;
      const top = point.y * props.camera.zoom + props.camera.y;
      const label = node.text || "主题";
      return <div key={node.id} className="board-mindmap-node-controls" style={{ left, top }}>
        {descendants.length ? <Tooltip label={node.structure.collapsed ? `展开 ${descendants.length} 个子主题` : "收起子主题"}>
          <ActionButton className="board-mindmap-toggle" aria-label={`${node.structure.collapsed ? "展开" : "收起"}“${label}”的子主题`} aria-expanded={!node.structure.collapsed} isDisabled={pending === node.id} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()} onPress={() => {
            try { void submit(node, toggleTopicCollapsed(node, live.current.elements)); }
            catch (error) { live.current.onError(error); }
          }}>
            {node.structure.collapsed ? <><ChevronRight size={12} /><span>{descendants.length}</span></> : <ChevronDown size={14} />}
          </ActionButton>
        </Tooltip> : null}
        {selectedID === node.id ? <Tooltip label="添加子主题（Tab）">
          <ActionButton className="board-mindmap-add" aria-label={`为“${label}”添加子主题`} isDisabled={pending === node.id} style={{ left: descendants.length ? "var(--board-mindmap-control-spacing)" : 0 }} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()} onPress={() => {
            try {
              const current = live.current.elements.get(node.id);
              if (!current) return;
              const result = appendTopic(current, live.current.elements, false);
              void submit(current, result.commands, result.id);
            } catch (error) { live.current.onError(error); }
          }}><Plus size={14} /></ActionButton>
        </Tooltip> : null}
      </div>;
    })}
  </div>;
}
