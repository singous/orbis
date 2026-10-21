import { SelectField } from "../../../shared/ui/SelectField";
import { ActionButton } from "../../../shared/ui/ActionButton";
import { Input as HeroInput } from "@heroui/react/input";
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
import { BookOpen, Code2, Info, Layers, ListOrdered, Plus, Settings2, CircleCheck, TriangleAlert, OctagonAlert } from "../../../shared/ui/icons";
import { lazy, Suspense, useContext, useEffect, useRef, useState } from "react";

import { ContentMedia } from "../../content/ContentMedia";
import { contentCellStyle, contentInlineStyle, contentTextAlignment } from "../../content/content-format";
import { CODE_LANGUAGES } from "../../content/CodeBlock";
import { DOCUMENT_BLOCKS, documentBlockTitle, documentBlockDefinition, type DocumentBlockKind } from "../../content/model/document-components";
import { safeContentUrl } from "../../content/ContentRenderer";
import { EditorReadOnlyContext } from "./tiptap-editor-context";
import { createDocumentBlock } from "./tiptap-insert";
import { clipboardPropsAttribute, parseClipboardProps } from "./tiptap-clipboard";
import { OrbisBlockIds } from "./tiptap-block-ids";
import { OrbisGroupEditing } from "./tiptap-group-editing";
import { OrbisDrawing } from "./tiptap-drawing";
import { OrbisCodeHighlight } from "./tiptap-code-highlight";
import { OrbisMarkdownPaste } from "./markdown-paste";
import { toTiptapDocumentForSchema } from "./tiptap-model";
import "../../../styles/document-editor.css";

const hidden = { default: null, parseHTML: () => null, renderHTML: () => ({}) };
const blockIdentity = { ...hidden, renderHTML: (attributes: Record<string, unknown>) => attributes.orbisId && !attributes.orbisOwn ? { "data-orbis-block-id": attributes.orbisId } : {} };

/** Stored v2 metadata stays in editor JSON only. It is never copied into HTML. */
const OrbisMetadata = Extension.create({
  name: "orbisMetadata",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading", "codeBlock", "horizontalRule", "blockquote", "listItem", "taskItem", "table", "tableCell", "tableHeader"],
      attributes: { orbisId: blockIdentity, orbisProps: { ...hidden, parseHTML: (element: HTMLElement) => parseClipboardProps(element), renderHTML: (attributes: Record<string, unknown>) => {
        const alignment = contentTextAlignment((attributes.orbisProps as Record<string, unknown> | undefined)?.textAlignment);
        return { ...clipboardPropsAttribute(attributes.orbisProps), ...(alignment ? { style: `text-align: ${alignment}` } : {}) };
      } }, orbisOriginal: hidden, orbisSignature: hidden, orbisOwn: { default: false, parseHTML: (element: HTMLElement) => element.hasAttribute("data-orbis-own"), renderHTML: (attributes: Record<string, unknown>) => attributes.orbisOwn ? { "data-orbis-own": "true" } : {} }, orbisCellOriginal: hidden, orbisCellProps: { ...hidden, parseHTML: (element: HTMLElement) => parseClipboardProps(element, "data-orbis-cell-props"), renderHTML: (attributes: Record<string, unknown>) => {
        const style = contentCellStyle((attributes.orbisCellProps ?? {}) as Record<string, unknown>);
        const values = [style.color ? `color: ${style.color}` : "", style.backgroundColor ? `background-color: ${style.backgroundColor}` : "", style.textAlign ? `text-align: ${style.textAlign}` : ""].filter(Boolean);
        return { ...clipboardPropsAttribute(attributes.orbisCellProps, "data-orbis-cell-props"), ...(values.length ? { style: values.join("; ") } : {}) };
      } }, headerRows: hidden, headerCols: hidden, columnWidths: hidden },
    }];
  },
});

const OrbisStyle = Mark.create({
  name: "orbisStyle",
  addAttributes() { return { styles: { default: {} } }; },
  parseHTML() { return [{ tag: "span[data-orbis-style]", getAttrs: (element) => ({ styles: parseClipboardProps(element as HTMLElement, "data-orbis-styles") }) }]; },
  renderHTML({ HTMLAttributes }) {
    const colors = contentInlineStyle(HTMLAttributes.styles ?? {});
    const style = [colors.color ? `color: ${colors.color}` : "", colors.backgroundColor ? `background-color: ${colors.backgroundColor}` : ""].filter(Boolean).join("; ");
    return ["span", { "data-orbis-style": "true", ...clipboardPropsAttribute(HTMLAttributes.styles, "data-orbis-styles"), ...(style ? { style } : {}) }, 0];
  },
});

const GROUP_CHILD: Partial<Record<DocumentBlockKind, DocumentBlockKind | "codeBlock">> = { cardGroup: "card", steps: "step", tabs: "tab", codeGroup: "codeBlock" };
const PROP_LABELS: Record<string, string> = { title: "标题", href: "链接", tone: "提示类型", columns: "每行卡片数量" };
const VALUE_LABELS: Record<string, string> = { info: "说明", success: "成功", warning: "注意", danger: "警告" };

const LazyDataTableBlock = lazy(() => import("../../data-tables/DataTable").then(module => ({ default: module.DataTableBlock })));
function ComponentNodeView(props: NodeViewProps) {
  const readOnly = useContext(EditorReadOnlyContext);
  if (props.node.attrs.kind === "dataTable") return <NodeViewWrapper data-orbis-block-id={props.node.attrs.orbisId} contentEditable={false} className="orbis-data-table"><Suspense fallback={<div>正在准备多维表格…</div>}><LazyDataTableBlock blockId={String(props.node.attrs.orbisId)} props={props.node.attrs.orbisProps ?? {}} readOnly={readOnly} /></Suspense></NodeViewWrapper>;
  return <ComponentView {...props} />;
}

function ComponentView({ node, editor, updateAttributes, getPos }: NodeViewProps) {
  const readOnly = useContext(EditorReadOnlyContext);
  const kind = node.attrs.kind as DocumentBlockKind;
  const definition = DOCUMENT_BLOCKS[kind];
  const props = (node.attrs.orbisProps ?? {}) as Record<string, unknown>;
  const title = documentBlockTitle({ type: kind, props });
  const CalloutIcon = ({ info: Info, success: CircleCheck, warning: TriangleAlert, danger: OctagonAlert } as Record<string, typeof Info>)[String(props.tone)] || Info;
  const Icon = kind === "callout" ? CalloutIcon : kind === "steps" || kind === "step" ? ListOrdered : kind === "codeGroup" ? Code2 : kind === "tabs" || kind === "tab" ? Layers : BookOpen;
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(() => node.firstChild?.attrs.orbisId ?? null);
  const [editingProps, setEditingProps] = useState(false);
  const paneShell = useRef<HTMLDivElement>(null);
  const switchable = kind === "tabs" || kind === "codeGroup";
  const paneKeys = switchable ? Array.from({ length: node.childCount }, (_, index) => String(node.child(index).attrs.orbisId ?? `pane-${index}`)) : [];
  const activePane = Math.max(0, paneKeys.indexOf(selectedPaneId ?? ""));
  const activePaneId = paneKeys[activePane] ?? null;
  useEffect(() => {
    if (switchable && selectedPaneId !== activePaneId) setSelectedPaneId(activePaneId);
  }, [switchable, selectedPaneId, activePaneId]);
  const paneLabels = switchable ? Array.from({ length: node.childCount }, (_, index) => {
    const child = node.child(index);
    const code = child.type.name === "orbisContainer" ? child.firstChild ?? child : child;
    return kind === "codeGroup" ? CODE_LANGUAGES[String(code.attrs.language ?? "text")] || String(code.attrs.language ?? "text") : String(child.attrs.orbisProps?.title ?? `标签 ${index + 1}`);
  }) : [];
  useEffect(() => {
    if (!switchable || !paneShell.current) return;
    const shell = paneShell.current;
    const update = () => {
      const content = shell.querySelector(".doc-editor-content");
      const contentRoot = content?.querySelector(":scope > [data-node-view-content-react]") as HTMLElement | null;
      if (contentRoot) contentRoot.style.display = "";
      const panes = contentRoot?.children ?? content?.children;
      let paneIndex = -1;
      Array.from(panes ?? []).forEach(element => {
        const child = element as HTMLElement;
        // Reading widgets are siblings of the block they hydrate. Associate
        // them by identity so they neither shift nor disappear from the pane.
        const loaderId = child.dataset.blockLoader;
        if (!loaderId) paneIndex += 1;
        child.style.display = (loaderId ? loaderId === activePaneId : paneIndex === activePane) ? "" : "none";
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
    const content = toTiptapDocumentForSchema({ schema_version: 2, editor: "blocknote", blocks: [child] }, editor.schema).content?.[0];
    if (content) editor.chain().focus().insertContentAt(position + node.nodeSize - 1, content).run();
  }
  if (kind === "group") return <NodeViewWrapper as="section" data-orbis-block-id={node.attrs.orbisId} className="doc-editor-group" data-document-component="group"><NodeViewContent as="div" /></NodeViewWrapper>;
  return <NodeViewWrapper as="section" data-orbis-block-id={node.attrs.orbisId} className={`doc-editor-block doc-editor-${kind}`} data-document-component={kind} data-tone={kind === "callout" ? String(props.tone ?? "info") : undefined} data-columns={kind === "cardGroup" ? String(props.columns ?? 2) : undefined}>
    {!readOnly ? <ActionButton type="button" className="doc-editor-settings" contentEditable={false} aria-label={`编辑${definition.label}属性`} aria-expanded={editingProps} onClick={() => setEditingProps((value) => !value)}><Settings2 size={14} aria-hidden="true" /></ActionButton> : null}
    {kind === "card" || kind === "callout" ? <div className="doc-editor-heading" contentEditable={false}><Icon size={kind === "card" ? 22 : 19} aria-hidden="true" /></div> : null}
    {title && kind !== "tab" ? <strong contentEditable={false} className="doc-editor-title">{title}</strong> : null}
    {!readOnly && editingProps ? <div className="doc-editor-controls" contentEditable={false} onKeyDown={(event) => event.stopPropagation()}>
      {Object.entries(definition.props).map(([name, rule]) => {
        const label = name === "title" ? definition.label + "标题" : PROP_LABELS[name] || name;
        if (rule.values) return <SelectField key={name} label={label} value={String(props[name] ?? rule.default)} onChange={(value) => updateProps({ [name]: typeof rule.default === "number" ? Number(value) : value })} options={rule.values.map((value) => ({ value: String(value), label: VALUE_LABELS[String(value)] || String(value) }))} />;
        return <label key={name}><span>{label}</span><HeroInput aria-label={label} maxLength={rule.maxLength} value={String(props[name] ?? rule.default)}
          placeholder={name === "href" ? "https://… 或内部文档链接" : "输入标题"}
          onChange={(event) => updateProps({ [name]: event.target.value })} /></label>;
      })}
      {GROUP_CHILD[kind] ? <ActionButton type="button" onClick={addChild}><Plus size={13} aria-hidden="true" />添加{kind === "codeGroup" ? "代码示例" : DOCUMENT_BLOCKS[GROUP_CHILD[kind] as DocumentBlockKind].label}</ActionButton> : null}
    </div> : null}
    {switchable ? <div role="tablist" aria-label={kind === "tabs" ? "文档标签" : "代码语言"} className="doc-editor-panes" contentEditable={false}>{paneLabels.map((label, index) => <ActionButton key={paneKeys[index]} role="tab" aria-selected={index === activePane} type="button" onClick={() => setSelectedPaneId(paneKeys[index])}>{label}</ActionButton>)}</div> : null}
    <div ref={paneShell} className="doc-editor-body"><NodeViewContent as="div" className="doc-editor-content" /></div>
  </NodeViewWrapper>;
}

const OrbisComponent = Node.create({
  name: "orbisComponent", group: "block", content: "block*", defining: true,
  addAttributes() { return { orbisId: blockIdentity, orbisProps: { ...hidden, parseHTML: (element: HTMLElement) => parseClipboardProps(element), renderHTML: (attributes: Record<string, unknown>) => clipboardPropsAttribute(attributes.orbisProps) }, orbisOriginal: hidden, orbisSignature: hidden, kind: { default: "callout", parseHTML: () => null, rendered: false } }; },
  parseHTML() { return [{ tag: "section[data-document-component]", getAttrs: (element) => { const kind = (element as HTMLElement).dataset.documentComponent; return kind && documentBlockDefinition(kind) ? { kind } : false; } }]; },
  renderHTML({ node, HTMLAttributes }) { return ["section", mergeAttributes(HTMLAttributes, { "data-document-component": node.attrs.kind }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(ComponentNodeView); },
});

function MediaView({ node, editor, updateAttributes }: NodeViewProps) {
  const readOnly = useContext(EditorReadOnlyContext);
  const kind = node.attrs.kind as "image" | "video" | "audio" | "file";
  const props = (node.attrs.orbisProps ?? {}) as Record<string, unknown>;
  const caption = String(props.caption ?? props.name ?? "");
  const reference = String(node.attrs.url ?? "");
  const [editingCaption, setEditingCaption] = useState(false);
  return <NodeViewWrapper data-orbis-block-id={node.attrs.orbisId} className="orbis-media" contentEditable={false}>
    <ContentMedia kind={kind} reference={reference} fallback={safeContentUrl(reference, true)} name={caption || "附件"} caption={caption || undefined} previewWidth={props.previewWidth} />
    {!readOnly ? <ActionButton type="button" className="doc-editor-settings" aria-label="编辑媒体说明" aria-expanded={editingCaption} onClick={() => setEditingCaption((value) => !value)}><Settings2 size={14} /></ActionButton> : null}
    {!readOnly && editingCaption ? <label className="orbis-media-caption">说明<HeroInput aria-label="媒体说明" value={caption} onChange={(event) => updateAttributes({ orbisProps: { ...props, caption: event.target.value }, caption: event.target.value })} /></label> : null}
  </NodeViewWrapper>;
}

const OrbisMedia = Node.create({
  name: "orbisMedia", group: "block", atom: true, selectable: true,
  addAttributes() { return { orbisId: blockIdentity, orbisProps: hidden, orbisOriginal: hidden, orbisSignature: hidden, kind: { default: "file", parseHTML: () => null }, url: { default: "", parseHTML: () => null }, caption: { default: "", parseHTML: () => null } }; },
  parseHTML() { return [{ tag: "figure[data-orbis-media]", getAttrs: (element) => {
    const figure = element as HTMLElement;
    const kind = figure.dataset.orbisMedia;
    if (!kind || !["image", "video", "audio", "file"].includes(kind)) return false;
    const props = parseClipboardProps(figure);
    const url = String(props.url ?? figure.dataset.src ?? "");
    const caption = String(props.caption ?? figure.querySelector("figcaption")?.textContent ?? "");
    return { kind, url, caption, orbisProps: { ...props, url, caption } };
  } }]; },
  renderHTML({ node }) { return ["figure", { "data-orbis-media": node.attrs.kind, "data-src": node.attrs.url, ...clipboardPropsAttribute({ ...node.attrs.orbisProps, url: node.attrs.url, caption: node.attrs.caption }) }, ["figcaption", {}, node.attrs.caption || ""]]; },
  addNodeView() { return ReactNodeViewRenderer(MediaView); },
});

const OrbisToggleSummary = Node.create({
  name: "orbisToggleSummary", content: "inline*", defining: true,
  addAttributes() { return { orbisOwn: { default: true, rendered: false } }; },
  parseHTML() { return [{ tag: "summary" }]; },
  renderHTML() { return ["summary", {}, 0]; },
});
const OrbisToggle = Node.create({
  name: "orbisToggle", group: "block", content: "orbisToggleSummary block*", defining: true,
  addAttributes() { return { orbisId: blockIdentity, orbisProps: hidden, orbisOriginal: hidden, orbisSignature: hidden }; },
  parseHTML() { return [{ tag: "details[data-orbis-toggle]" }]; },
  renderHTML({ HTMLAttributes }) { return ["details", mergeAttributes(HTMLAttributes, { "data-orbis-toggle": "true", class: "orbis-toggle", open: "" }), 0]; },
});

const OrbisContainer = Node.create({
  name: "orbisContainer", group: "block", content: "block+", defining: true,
  addAttributes() { return { orbisId: blockIdentity, orbisProps: hidden, orbisOriginal: hidden, orbisSignature: hidden, kind: { default: "paragraph" } }; },
  parseHTML() { return [{ tag: "div[data-orbis-container]" }]; },
  renderHTML({ node, HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-orbis-container": node.attrs.kind }), 0]; },
});

function CodeView({ node, editor, updateAttributes }: NodeViewProps) {
  const readOnly = useContext(EditorReadOnlyContext);
  const language = String(node.attrs.language ?? "text");
  return <NodeViewWrapper as="div" data-orbis-block-id={node.attrs.orbisOwn ? undefined : node.attrs.orbisId} className="orbis-code">
    <div className="orbis-code-toolbar" contentEditable={false}>{!readOnly ? <SelectField density="compact" aria-label="代码语言" value={language} onChange={(value) => updateAttributes({ language: value })} options={Object.entries({ ...CODE_LANGUAGES, ...(Object.hasOwn(CODE_LANGUAGES, language) ? {} : { [language]: language }) }).map(([value, label]) => ({ value, label }))} /> : <SelectField density="compact" aria-label="代码语言" value={language} disabled onChange={() => {}} options={[{ value: language, label: CODE_LANGUAGES[language] || language }]} />}</div>
    <pre><NodeViewContent as="code" style={{ whiteSpace: "pre" }} /></pre>
  </NodeViewWrapper>;
}

const EditableCodeBlock = CodeBlock.extend({
  addNodeView() { return ReactNodeViewRenderer(CodeView); },
});

const ScrollableTable = Table.extend({
  renderHTML(props) { return ["div", { class: "content-table-scroll" }, this.parent!(props)]; },
});

export const tiptapExtensions = [
  StarterKit.configure({ codeBlock: false }), EditableCodeBlock, Underline,
  Link.configure({ openOnClick: false, autolink: true }),
  Placeholder.configure({ placeholder: "输入正文，或输入 / 插入内容…" }),
  TaskList, TaskItem.configure({ nested: true }),
  ScrollableTable.configure({ resizable: false }), TableRow, TableHeader, TableCell,
  OrbisMetadata, OrbisStyle, OrbisComponent, OrbisMedia, OrbisDrawing, OrbisToggle, OrbisToggleSummary, OrbisContainer, OrbisBlockIds, OrbisGroupEditing, OrbisCodeHighlight, OrbisMarkdownPaste,
];
