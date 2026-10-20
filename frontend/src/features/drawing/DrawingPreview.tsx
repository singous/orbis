import { useState, type ReactNode } from "react";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Dialog, DialogContent } from "../../shared/ui/Dialog";
import { Eye, PencilLine } from "../../shared/ui/icons";
import { ContentMedia } from "../content/ContentMedia";
import { safeContentUrl } from "../content/ContentRenderer";
import "../../styles/drawing.css";

/** Reading never loads the drawing engine or exposes its editable scene. */
export function DrawingPreview({ props, actions }: { props: Record<string, unknown>; actions?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const reference = typeof props.url === "string" ? props.url : "";
  const caption = String(props.caption || "画板");
  const preview = <ContentMedia kind="image" reference={reference} fallback={safeContentUrl(reference, true)} name={caption} />;
  return <section className="drawing-block" aria-label={caption} data-drawing-block>
    <div className="drawing-block-bar"><span className="drawing-block-label"><PencilLine size={16} aria-hidden="true" />{caption}</span><div className="drawing-block-actions">
      {reference ? <ActionButton aria-label="放大查看画板" onClick={() => setExpanded(true)}><Eye size={15} aria-hidden="true" />放大查看</ActionButton> : null}{actions}
    </div></div>
    {reference ? <div className="drawing-preview">{preview}</div> : <div className="drawing-empty"><PencilLine size={30} aria-hidden="true" /><span>用图形和线条表达想法</span><small>{actions ? "点击编辑画板，开始绘制" : "这张画板还没有内容"}</small></div>}
    {expanded ? <Dialog open onOpenChange={setExpanded}><DialogContent title={caption} className="drawing-preview-dialog"><div className="drawing-expanded">{preview}</div></DialogContent></Dialog> : null}
  </section>;
}
