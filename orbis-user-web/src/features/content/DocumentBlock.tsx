import { BookOpen, CircleCheck, ExternalLink, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { codeLanguageLabel } from "./CodeBlock";
import { DocumentTabs } from "./DocumentTabs";
import { documentBlockTitle } from "./document-components";

type Node = Record<string, unknown>;
const asNode = (value: unknown): Node => value && typeof value === "object" && !Array.isArray(value) ? value as Node : {};
const childrenOf = (value: unknown): unknown[] => Array.isArray(asNode(value).children) ? asNode(value).children as unknown[] : [];

export function DocumentBlock({ kind, props, inline, children, childBlocks, path, renderChild, renderChildren, safeUrl }: {
  kind: string; props: Node; inline: ReactNode; children: ReactNode; childBlocks: unknown[]; path: number[];
  renderChild: (value: unknown, path: number[]) => ReactNode;
  renderChildren: (values: unknown[], path: number[]) => ReactNode;
  safeUrl: (value: unknown) => string | null;
}) {
  const title = documentBlockTitle({ type: kind, props });
  if (kind === "callout") {
    const tone = ["info", "success", "warning", "danger"].includes(String(props.tone)) ? String(props.tone) : "info";
    const Icon = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: OctagonAlert }[tone] || Info;
    return <aside role="note" aria-label={title || "提示"} className={"doc-callout doc-callout-" + tone}><Icon size={19} aria-hidden="true" /><div>{title ? <strong className="doc-callout-title">{title}</strong> : null}<div className="doc-callout-inline">{inline}</div>{children}</div></aside>;
  }
  if (kind === "card") {
    const href = props.href ? safeUrl(props.href) : null;
    return <section className="doc-card"><BookOpen size={22} aria-hidden="true" /><h3>{href ? <a href={href} rel="noopener noreferrer">{title}<ExternalLink size={14} aria-hidden="true" /></a> : title}</h3><div>{children}</div></section>;
  }
  if (kind === "cardGroup") return <div className="doc-card-grid" style={{ "--doc-card-columns": props.columns === 3 ? 3 : 2 } as CSSProperties}>{children}</div>;
  if (kind === "steps") return <ol className="doc-steps" aria-label="步骤">{childBlocks.map((child, index) => <li key={index}>{renderChild(child, [...path, index])}</li>)}</ol>;
  if (kind === "step" || kind === "tab") return <section className={"doc-" + kind}><h3>{title}</h3>{children}</section>;
  if (kind === "tabs" || kind === "codeGroup") {
    const panels = childBlocks.map((child, index) => {
      const item = asNode(child);
      const childProps = asNode(item.props);
      return {
        title: kind === "codeGroup" ? codeLanguageLabel(String(childProps.language || "text")) : documentBlockTitle({ type: "tab", props: childProps }),
        content: kind === "codeGroup" ? renderChild(child, [...path, index]) : renderChildren(childrenOf(child), [...path, index]),
      };
    });
    return <DocumentTabs id={"doc-tabs-" + path.join("-")} panels={panels} />;
  }
  return <>{inline}{children}</>;
}
