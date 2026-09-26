import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { BookOpen, Code2, Info, Layers, ListOrdered, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ContentMedia } from "../content/ContentMedia";
import { contentCellStyle, contentInlineStyle, contentTextAlignment } from "../content/content-format";
import { CODE_LANGUAGES } from "../content/CodeBlock";
import { DOCUMENT_BLOCKS, documentBlockTitle, type DocumentBlockKind } from "../content/document-components";
import { safeContentUrl } from "../content/ContentRenderer";
import { createDocumentBlock } from "./tiptap-insert";
import { OrbisBlockIds } from "./tiptap-block-ids";
import { OrbisGroupEditing } from "./tiptap-group-editing";
import { toTiptapDocument } from "./tiptap-model";
import "../../styles/document-editor.css";

const hidden = { default: null, parseHTML: () => null, renderHTML: () => ({}) };

/** Stored v2 metadata stays in editor JSON only. It is never copied into HTML. */
const OrbisMetadata = Extension.create({
  name: "orbisMetadata",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading", "codeBlock", "horizontalRule", "blockquote", "listItem", "taskItem", "table", "tableCell", "tableHeader"],
      attributes: { orbisId: hidden, orbisProps: { ...hidden, renderHTML: (attributes: Record<string, unknown>) => {
        const alignment = contentTextAlignment((attributes.orbisProps as Record<string, unknown> | undefined)?.textAlignment);
        return alignment ? { style: `text-align: ${alignment}` } : {};
      } }, orbisOriginal: hidden, orbisSignature: hidden, orbisOwn: { ...hidden, default: false }, orbisCellOriginal: hidden, orbisCellProps: { ...hidden, renderHTML: (attributes: Record<string, unknown>) => {
        const style = contentCellStyle((attributes.orbisCellProps ?? {}) as Record<string, unknown>);
        const values = [style.color ? `color: ${style.color}` : "", style.backgroundColor ? `background-color: ${style.backgroundColor}` : "", style.textAlign ? `text-align: ${style.textAlign}` : ""].filter(Boolean);
        return values.length ? { style: values.join("; ") } : {};
      } }, headerRows: hidden, headerCols: hidden, columnWidths: hidden },
    }];
  },
});

const OrbisStyle = Mark.create({
  name: "orbisStyle",
  addAttributes() { return { styles: { default: {} } }; },
  parseHTML() { return [{ tag: "span[data-orbis-style]" }]; },
  renderHTML({ HTMLAttributes }) {
    const colors = contentInlineStyle(HTMLAttributes.styles ?? {});
    const style = [colors.color ? `color: ${colors.color}` : "", colors.backgroundColor ? `background-color: ${colors.backgroundColor}` : ""].filter(Boolean).join("; ");
    return ["span", { "data-orbis-style": "true", ...(style ? { style } : {}) }, 0];
  },
});

const GROUP_CHILD: Partial<Record<DocumentBlockKind, DocumentBlockKind | "codeBlock">> = { cardGroup: "card", steps: "step", tabs: "tab", codeGroup: "codeBlock" };
const PROP_LABELS: Record<string, string> = { title: "标题", href: "链接", tone: "提示类型", columns: "每行卡片数量" };
const VALUE_LABELS: Record<string, string> = { info: "说明", success: "成功", warning: "注意", danger: "警告" };

function ComponentView({ node, editor, updateAttributes, getPos }: NodeViewProps) {
  const kind = node.attrs.kind as DocumentBlockKind;
  const definition = DOCUMENT_BLOCKS[kind];
  const props = (node.attrs.orbisProps ?? {}) as Record<string, unknown>;
  const title = documentBlockTitle({ type: kind, props });
  const Icon = kind === "callout" ? Info : kind === "steps" || kind === "step" ? ListOrdered : kind === "codeGroup" ? Code2 : kind === "tabs" || kind === "tab" ? Layers : BookOpen;
  const [activePane, setActivePane] = useState(0);
  const paneShell = useRef<HTMLDivElement>(null);
  const switchable = kind === "tabs" || kind === "codeGroup";
  const paneLabels = switchable ? Array.from({ length: node.childCount }, (_, index) => {
    const child = node.child(index);
    return kind === "codeGroup" ? CODE_LANGUAGES[String(child.attrs.language ?? "text")] || String(child.attrs.language ?? "text") : String(child.attrs.orbisProps?.title ?? `标签 ${index + 1}`);
  }) : [];
  useEffect(() => {
    if (!switchable || !paneShell.current) return;
    const shell = paneShell.current;
    const update = () => {
      const content = shell.querySelector(".doc-editor-content");
      const contentRoot = content?.querySelector(":scope > [data-node-view-content-react]") as HTMLElement | null;
      if (contentRoot) contentRoot.style.display = "";
      const panes = contentRoot?.children ?? content?.children;
      Array.from(panes ?? []).forEach((element, index) => {
        (element as HTMLElement).style.display = index === activePane ? "" : "none";
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(shell, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [activePane, node, switchable]);
  const updateProps = (patch: Record<string, unknown>) => updateAttributes({ orbisProps: { ...props, ...patch } });
  function addChild() {
    const childKind = GROUP_CHILD[kind];
    const position = getPos();
    if (!childKind || position === undefined) return;
    const child = createDocumentBlock(childKind);
    const content = toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: [child] }).content?.[0];
    if (content) editor.chain().focus().insertContentAt(position + node.nodeSize - 1, content).run();
  }
  return <NodeViewWrapper as="section" className={`doc-editor-block doc-editor-${kind}`} data-document-component={kind} data-tone={kind === "callout" ? String(props.tone ?? "info") : undefined} data-columns={kind === "cardGroup" ? String(props.columns ?? 2) : undefined}>
    <div className="doc-editor-heading" contentEditable={false}><Icon size={15} aria-hidden="true" /><span>{definition.label}</span></div>
    {title ? <strong contentEditable={false} className="doc-editor-title">{title}</strong> : null}
    {editor.isEditable ? <div className="doc-editor-controls" contentEditable={false} onKeyDown={(event) => event.stopPropagation()}>
      {Object.entries(definition.props).map(([name, rule]) => {
        const label = name === "title" ? definition.label + "标题" : PROP_LABELS[name] || name;
        return <label key={name}><span>{label}</span>{rule.values ? <select aria-label={label} value={String(props[name] ?? rule.default)} onChange={(event) => updateProps({ [name]: typeof rule.default === "number" ? Number(event.target.value) : event.target.value })}>
          {rule.values.map((value) => <option key={value} value={value}>{VALUE_LABELS[String(value)] || String(value)}</option>)}
        </select> : <input aria-label={label} maxLength={rule.maxLength} value={String(props[name] ?? rule.default)}
          placeholder={name === "href" ? "https://… 或内部文档链接" : "输入标题"}
          onChange={(event) => updateProps({ [name]: event.target.value })} />}</label>;
      })}
      {GROUP_CHILD[kind] ? <button type="button" onClick={addChild}><Plus size={13} aria-hidden="true" />添加{kind === "codeGroup" ? "代码示例" : DOCUMENT_BLOCKS[GROUP_CHILD[kind] as DocumentBlockKind].label}</button> : null}
    </div> : null}
    {switchable ? <div role="tablist" aria-label={kind === "tabs" ? "文档标签" : "代码语言"} className="doc-editor-panes" contentEditable={false}>{paneLabels.map((label, index) => <button key={index} role="tab" aria-selected={index === activePane} type="button" onClick={() => setActivePane(index)}>{label}</button>)}</div> : null}
    <div ref={paneShell}><NodeViewContent as="div" className="doc-editor-content" /></div>
  </NodeViewWrapper>;
}

const OrbisComponent = Node.create({
  name: "orbisComponent", group: "block", content: "block*", defining: true,
  addAttributes() { return { orbisId: hidden, orbisProps: hidden, orbisOriginal: hidden, orbisSignature: hidden, kind: { default: "callout" } }; },
  parseHTML() { return [{ tag: "section[data-document-component]", getAttrs: (element) => ({ kind: (element as HTMLElement).dataset.documentComponent }) }]; },
  renderHTML({ node, HTMLAttributes }) { return ["section", mergeAttributes(HTMLAttributes, { "data-document-component": node.attrs.kind }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(ComponentView); },
});

function MediaView({ node, editor, updateAttributes }: NodeViewProps) {
  const kind = node.attrs.kind as "image" | "video" | "audio" | "file";
  const props = (node.attrs.orbisProps ?? {}) as Record<string, unknown>;
  const caption = String(props.caption ?? props.name ?? "");
  const reference = String(node.attrs.url ?? "");
  return <NodeViewWrapper className="orbis-media" contentEditable={false}>
    <ContentMedia kind={kind} reference={reference} fallback={safeContentUrl(reference, true)} name={caption || "附件"} caption={caption || undefined} />
    {editor.isEditable ? <label className="orbis-media-caption">说明<input aria-label="媒体说明" value={caption} onChange={(event) => updateAttributes({ orbisProps: { ...props, caption: event.target.value }, caption: event.target.value })} /></label> : null}
  </NodeViewWrapper>;
}

const OrbisMedia = Node.create({
  name: "orbisMedia", group: "block", atom: true, selectable: true,
  addAttributes() { return { orbisId: hidden, orbisProps: hidden, orbisOriginal: hidden, orbisSignature: hidden, kind: { default: "file" }, url: { default: "" }, caption: { default: "" } }; },
  parseHTML() { return [{ tag: "figure[data-orbis-media]", getAttrs: (element) => ({ kind: (element as HTMLElement).dataset.orbisMedia }) }]; },
  renderHTML({ node }) { return ["figure", { "data-orbis-media": node.attrs.kind, "data-src": node.attrs.url }, ["figcaption", {}, node.attrs.caption || ""]]; },
  addNodeView() { return ReactNodeViewRenderer(MediaView); },
});

function ToggleView({ editor }: NodeViewProps) {
  return <NodeViewWrapper as="details" className="orbis-toggle" open><summary contentEditable={false}>展开内容</summary><NodeViewContent as="div" /></NodeViewWrapper>;
}
const OrbisToggle = Node.create({
  name: "orbisToggle", group: "block", content: "block*", defining: true,
  addAttributes() { return { orbisId: hidden, orbisProps: hidden, orbisOriginal: hidden, orbisSignature: hidden }; },
  parseHTML() { return [{ tag: "details[data-orbis-toggle]" }]; },
  renderHTML() { return ["details", { "data-orbis-toggle": "true" }, 0]; },
  addNodeView() { return ReactNodeViewRenderer(ToggleView); },
});

const OrbisContainer = Node.create({
  name: "orbisContainer", group: "block", content: "block+", defining: true,
  addAttributes() { return { orbisId: hidden, orbisProps: hidden, orbisOriginal: hidden, orbisSignature: hidden, kind: { default: "paragraph" } }; },
  parseHTML() { return [{ tag: "div[data-orbis-container]" }]; },
  renderHTML({ node }) { return ["div", { "data-orbis-container": node.attrs.kind }, 0]; },
});

function CodeView({ node, editor, updateAttributes }: NodeViewProps) {
  const language = String(node.attrs.language ?? "text");
  return <NodeViewWrapper as="div" className="orbis-code">
    <div className="orbis-code-toolbar" contentEditable={false}>{editor.isEditable ? <select aria-label="代码语言" value={language} onChange={(event) => updateAttributes({ language: event.target.value })}>
      {Object.entries({ ...CODE_LANGUAGES, ...(Object.hasOwn(CODE_LANGUAGES, language) ? {} : { [language]: language }) }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select> : <select aria-label="代码语言" value={language} disabled><option value={language}>{CODE_LANGUAGES[language] || language}</option></select>}</div>
    <pre><NodeViewContent as="code" /></pre>
  </NodeViewWrapper>;
}

const EditableCodeBlock = CodeBlock.extend({
  addNodeView() { return ReactNodeViewRenderer(CodeView); },
});

export const tiptapExtensions = [
  StarterKit.configure({ codeBlock: false }), EditableCodeBlock, Underline,
  Link.configure({ openOnClick: false, autolink: true }),
  Placeholder.configure({ placeholder: "输入正文，或输入 / 插入内容…" }),
  TaskList, TaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
  OrbisMetadata, OrbisStyle, OrbisComponent, OrbisMedia, OrbisToggle, OrbisContainer, OrbisBlockIds, OrbisGroupEditing,
];
