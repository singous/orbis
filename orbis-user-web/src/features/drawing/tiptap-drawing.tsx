import { Node } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Component, useContext, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { PencilLine } from "../../shared/ui/icons";
import { useManagedFiles } from "../files/use-managed-files";
import { EditorReadOnlyContext } from "../notes/tiptap-editor-context";
import { clipboardPropsAttribute, parseClipboardProps } from "../notes/tiptap-clipboard";
import { blockActionNeedsRead, prepareBlockAction } from "../notes/blocks/block-action-read";
import type { DrawingEditorProps } from "./DrawingEditorDialog";
import { DrawingPreview } from "./DrawingPreview";
import { parseDrawingScene } from "./drawing-scene";

class DrawingEditorBoundary extends Component<{ children: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { console.error("Drawing editor failed to render; persisted document content is unchanged"); }
  render() {
    return this.state.failed ? <Dialog open onOpenChange={open => { if (!open) this.props.onClose(); }}><DialogContent title="画板暂时无法编辑"><p role="alert">画板加载失败，已保存的内容仍保留。请关闭后重试。</p><ActionButton onClick={this.props.onClose}>关闭画板</ActionButton></DialogContent></Dialog> : this.props.children;
  }
}

function DrawingView({ node, editor, updateAttributes, getPos }: NodeViewProps) {
  const readOnly = useContext(EditorReadOnlyContext);
  const files = useManagedFiles();
  const live = useRef({ readOnly, node, files });
  live.current = { readOnly, node, files };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{ Component: ComponentType<DrawingEditorProps>; scene: string; caption: string; scope: string } | null>(null);
  const props = (node.attrs.orbisProps ?? {}) as Record<string, unknown>;
  async function open() {
    setLoading(true); setError(null);
    try {
      await prepareBlockAction(editor, [node.attrs.orbisId]);
      const { default: Component } = await import("./DrawingEditorDialog");
      if (!mounted.current || live.current.readOnly || editor.isDestroyed) return;
      const position = getPos();
      const current = position === undefined ? null : editor.state.doc.nodeAt(position);
      if (!current || current.attrs.orbisId !== node.attrs.orbisId || current.type.name !== "orbisDrawing") throw new Error("目标画板已变化，请重新打开。");
      const source = current.attrs.orbisProps ?? {};
      parseDrawingScene(source.scene);
      setSession({ Component, scene: String(source.scene ?? ""), caption: String(source.caption || "画板"), scope: live.current.files.scope });
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "画板编辑器加载失败，请重试。"); }
    finally { if (mounted.current) setLoading(false); }
  }
  async function save(value: Parameters<DrawingEditorProps["onSave"]>[0]) {
    const check = () => {
      const position = getPos();
      const current = position === undefined || editor.isDestroyed ? null : editor.state.doc.nodeAt(position);
      if (!mounted.current || !current || current.type.name !== "orbisDrawing" || live.current.readOnly || !editor.isEditable || !session || live.current.files.scope !== session.scope || current.attrs.orbisId !== node.attrs.orbisId) throw new Error("文档已关闭或不可编辑，请保留绘制内容。");
      if (blockActionNeedsRead(editor, [node.attrs.orbisId])) throw new Error("画板原内容尚未完整载入，请先完成读取后重试。");
      if ((current.attrs.orbisProps?.scene ?? "") !== session.scene) throw new Error("正文中的画板已更新，请关闭后重新打开，避免覆盖较新的内容。");
    };
    check();
    const url = value.preview ? await files.upload(new File([value.preview], "drawing.png", { type: "image/png" })) : "";
    check();
    editor.view.dispatch(closeHistory(editor.state.tr));
    updateAttributes({ orbisProps: { ...live.current.node.attrs.orbisProps, scene: value.scene, caption: value.caption, url } });
    editor.view.dispatch(closeHistory(editor.state.tr));
    const position = getPos();
    const saved = position === undefined ? null : editor.state.doc.nodeAt(position)?.attrs.orbisProps;
    if (saved?.scene !== value.scene || saved?.url !== url || saved?.caption !== value.caption) throw new Error("画板尚未写回正文，本次绘制已保留，请重试。");
  }
  return <NodeViewWrapper data-orbis-block-id={node.attrs.orbisId} contentEditable={false} className="orbis-drawing" data-orbis-embedded-editor>
    <DrawingPreview props={props} actions={!readOnly ? <ActionButton aria-label="编辑画板" isPending={loading} onClick={() => void open()}><PencilLine size={15} aria-hidden="true" />编辑画板</ActionButton> : undefined} />
    {error ? <p role="alert" className="drawing-error">{error}</p> : null}
    {session && !readOnly ? <DrawingEditorBoundary onClose={() => setSession(null)}><session.Component scene={session.scene} caption={session.caption} onSave={save} onClose={() => setSession(null)} /></DrawingEditorBoundary> : null}
  </NodeViewWrapper>;
}

const hidden = { default: null, parseHTML: () => null, renderHTML: () => ({}) };
export const OrbisDrawing = Node.create({
  name: "orbisDrawing", group: "block", atom: true, selectable: true,
  addAttributes() { return { orbisId: { ...hidden, renderHTML: attributes => attributes.orbisId ? { "data-orbis-block-id": attributes.orbisId } : {} }, orbisProps: hidden, orbisOriginal: hidden, orbisSignature: hidden }; },
  parseHTML() { return [{ tag: "figure[data-orbis-drawing]", getAttrs: element => {
    const props = parseClipboardProps(element as HTMLElement);
    try { parseDrawingScene(props.scene); return { orbisProps: props }; } catch { return false; }
  } }]; },
  renderHTML({ node }) { return ["figure", { "data-orbis-drawing": "true", ...clipboardPropsAttribute(node.attrs.orbisProps) }, ["figcaption", {}, String(node.attrs.orbisProps?.caption || "画板")]]; },
  addNodeView() { return ReactNodeViewRenderer(DrawingView); },
});
