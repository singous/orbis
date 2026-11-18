import { cn } from "@orbis/ui/cn";
import { editorNodeSettingsClassName, editorNodeControlsClassName, editorNodeFieldClassName, editorPaneButtonClassName } from "./editor-control-styles";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@orbis/ui/select";
import { Button } from "@orbis/ui/button";
import { Input } from "@orbis/ui/input";
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
import { BookOpen, Code2, Copy, Image, Info, Layers, ListOrdered, Plus, Settings2, CircleCheck, TriangleAlert, OctagonAlert } from "../../../shared/ui/icons";
import { lazy, Suspense, useContext, useEffect, useRef, useState } from "react";

import { ContentMedia } from "../../content/ContentMedia";
import { contentCellStyle, contentInlineStyle, contentTextAlignment } from "../../content/content-format";
import { CODE_LANGUAGES, codeLanguageLabel, copyCode } from "../../content/CodeBlock";
import { reportError } from "../../../shared/api/request-feedback";
import { useManagedFiles } from "../../files/use-managed-files";
import { DOCUMENT_BLOCKS, documentBlockTitle, documentBlockDefinition, type DocumentBlockKind } from "../../content/model/document-components";
import { safeContentUrl } from "../../content/ContentRenderer";
import { EditorReadOnlyContext } from "./tiptap-editor-context";
import { createDocumentBlock } from "./tiptap-insert";
import { clipboardPropsAttribute, parseClipboardProps } from "./tiptap-clipboard";
import { OrbisBlockIds } from "./tiptap-block-ids";
import { OrbisGroupEditing } from "./tiptap-group-editing";
import { RetiredDrawing } from "./tiptap-retired";
import { OrbisBoard } from "./tiptap-board";
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

const LazySheetEmbed=lazy(()=>import("../../sheets/SheetEmbed").then(m=>({default:m.SheetEmbed})));
const LazyDataTableBlock = lazy(() => import("../../data-tables/DataTable").then(module => ({ default: module.DataTableBlock })));
function ComponentNodeView(props: NodeViewProps) {
  const readOnly = useContext(EditorReadOnlyContext);
  if (props.node.attrs.kind === "dataTable" && !props.node.attrs.orbisProps?.table_id) return <NodeViewWrapper data-orbis-block-id={props.node.attrs.orbisId} contentEditable={false} data-orbis-embedded-editor className="orbis-data-table"><Suspense fallback={<div>正在准备数据表…</div>}><LazySheetEmbed blockId={String(props.node.attrs.orbisId)} id={props.node.attrs.orbisProps?.sheet_id} viewId={props.node.attrs.orbisProps?.sheet_view_id} readOnly={readOnly} onBind={(sheet_id,sheet_view_id)=>props.updateAttributes({orbisProps:{...props.node.attrs.orbisProps,sheet_id,sheet_view_id}})} /></Suspense></NodeViewWrapper>;
  if (props.node.attrs.kind === "dataTable") return <NodeViewWrapper data-orbis-block-id={props.node.attrs.orbisId} contentEditable={false} data-orbis-embedded-editor className="orbis-data-table"><Suspense fallback={<div>正在准备数据表…</div>}><LazyDataTableBlock blockId={String(props.node.attrs.orbisId)} props={props.node.attrs.orbisProps ?? {}} readOnly={readOnly} /></Suspense></NodeViewWrapper>;
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
    {!readOnly ? <Button type="button" className={cn(editorNodeSettingsClassName, kind === "cardGroup" || kind === "steps" ? "-top-[25px]" : kind === "tabs" || kind === "codeGroup" ? "top-[5px]" : kind === "tab" ? "top-0" : "")} contentEditable={false} aria-label={`编辑${definition.label}属性`} aria-expanded={editingProps} onClick={() => setEditingProps((value) => !value)} variant="ghost" size="icon-sm"><Settings2 size={14} aria-hidden="true" /></Button> : null}
    {kind === "card" || kind === "callout" ? <div className="doc-editor-heading" contentEditable={false}><Icon size={kind === "card" ? 22 : 19} aria-hidden="true" /></div> : null}
    {title && kind !== "tab" ? <strong contentEditable={false} className="doc-editor-title">{title}</strong> : null}
    {!readOnly && editingProps ? <div className={cn(editorNodeControlsClassName, kind === "callout" && "col-span-full")} contentEditable={false} onKeyDown={(event) => { if (event.key !== "F6") event.stopPropagation(); }}>
      {Object.entries(definition.props).map(([name, rule]) => {
        const label = name === "title" ? definition.label + "标题" : PROP_LABELS[name] || name;
        if (rule.values) {
          const propertyItems = rule.values.map((value) => ({ value: String(value), label: VALUE_LABELS[String(value)] || String(value) }));
          return <label key={name} className="grid gap-2 text-sm font-medium"><span>{label}</span><Select
            value={String(props[name] ?? rule.default)}
            onValueChange={value => { if (value === null) return; updateProps({ [name]: typeof rule.default === "number" ? Number(value) : value }); }}
            items={propertyItems}
          >
            <SelectTrigger aria-label={label} className={cn("min-w-[125px] flex-1")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {propertyItems.map(item => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select></label>;
        }
        return <label className={editorNodeFieldClassName} key={name}><span className="[font-size:var(--text-sm)] text-(--muted-foreground)">{label}</span><Input aria-label={label} maxLength={rule.maxLength} value={String(props[name] ?? rule.default)}
          placeholder={name === "href" ? "https://… 或内部文档链接" : "输入标题"}
          onChange={(event) => updateProps({ [name]: event.target.value })} /></label>;
      })}
      {GROUP_CHILD[kind] ? <Button type="button" onClick={addChild} variant="outline"><Plus size={13} aria-hidden="true" />添加{kind === "codeGroup" ? "代码示例" : DOCUMENT_BLOCKS[GROUP_CHILD[kind] as DocumentBlockKind].label}</Button> : null}
    </div> : null}
    {switchable ? <div role="tablist" aria-label={kind === "tabs" ? "文档标签" : "代码语言"} className="doc-editor-panes flex gap-6 overflow-x-auto border-b border-(--reading-border) pr-[35px]" contentEditable={false}>{paneLabels.map((label, index) => <Button className={editorPaneButtonClassName} key={paneKeys[index]} role="tab" aria-selected={index === activePane} type="button" onClick={() => setSelectedPaneId(paneKeys[index])} variant="ghost">{label}</Button>)}</div> : null}
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

const imagePlaceholderClassName = "flex min-h-[122px] w-full flex-col items-center justify-center gap-2 rounded-sm border border-(--ob-document-media-border) bg-(--ob-document-media-surface) py-3 text-(--ob-document-block-ink)";

function ImageUploadBlock({ onImage }: { onImage: (url: string, name?: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { upload } = useManagedFiles();
  const [uploading, setUploading] = useState(false);

  function setImageLink(value: string) {
    const url = safeContentUrl(value.trim(), true);
    if (!url || !/^https?:\/\//i.test(url)) {
      reportError("请输入 HTTP 或 HTTPS 图片链接。");
      return;
    }
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      reportError("图片链接不能包含账号密码。");
      return;
    }
    onImage(url);
  }

  return <div data-image-placeholder className={imagePlaceholderClassName}>
    <Image aria-hidden="true" size={24} className="text-muted-foreground" />
    <div className="flex max-w-full flex-wrap items-center justify-center text-[13px]">
      <Button type="button" variant="ghost" size="xs" className="border-0 px-0 text-[13px] font-normal"
        disabled={uploading} onClick={() => input.current?.click()}>{uploading ? "正在上传图片…" : "点击上传图片"}</Button>
      <span>，或</span>
      <Input type="url" aria-label="图片链接" placeholder="粘贴图片链接" disabled={uploading}
        className="h-6 w-[6.2em] bg-transparent px-0 py-0 text-[13px] placeholder:text-inherit md:text-[13px]"
        onPaste={event => {
          event.preventDefault();
          event.stopPropagation();
          setImageLink(event.clipboardData.getData("text/plain"));
        }} onKeyDown={event => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          setImageLink(event.currentTarget.value);
        }} />
    </div>
    <span className="text-xs text-muted-foreground">支持 PNG、JPG、GIF、WebP</span>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden aria-label="选择图片" onChange={async event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setUploading(true);
      try { onImage(await upload(file), file.name); }
      catch (error) { reportError(error); }
      finally { setUploading(false); }
    }} />
  </div>;
}

function MediaView({ node, editor, updateAttributes }: NodeViewProps) {
  const readOnly = useContext(EditorReadOnlyContext);
  const kind = node.attrs.kind as "image" | "video" | "audio" | "file";
  const props = (node.attrs.orbisProps ?? {}) as Record<string, unknown>;
  const caption = String(props.caption ?? props.name ?? "");
  const reference = String(node.attrs.url ?? "");
  const [editingCaption, setEditingCaption] = useState(false);
  if (kind === "image" && !reference) return <NodeViewWrapper data-orbis-block-id={node.attrs.orbisId} className="orbis-media" contentEditable={false}>
    {readOnly ? <div data-image-placeholder className={imagePlaceholderClassName}><Image aria-hidden="true" size={24} /><span className="text-[13px]">图片尚未上传</span></div> : <ImageUploadBlock onImage={(url, name) => {
      if (editor.isEditable) updateAttributes({ url, caption: String(props.caption ?? name ?? ""), orbisProps: { ...props, ...(name ? { name } : {}) } });
    }} />}
  </NodeViewWrapper>;
  return <NodeViewWrapper data-orbis-block-id={node.attrs.orbisId} className="orbis-media" contentEditable={false}>
    <ContentMedia kind={kind} reference={reference} fallback={safeContentUrl(reference, true)} name={caption || "附件"} caption={caption || undefined} previewWidth={props.previewWidth} />
    {!readOnly ? <Button type="button" className={editorNodeSettingsClassName} aria-label="编辑媒体说明" aria-expanded={editingCaption} onClick={() => setEditingCaption((value) => !value)} variant="ghost" size="icon-sm"><Settings2 size={14} /></Button> : null}
    {!readOnly && editingCaption ? <label className="orbis-media-caption -mt-3 mb-5 grid max-w-[420px] gap-[3px] text-xs leading-[18px] text-(--reading-muted)">说明<Input aria-label="媒体说明" value={caption} onChange={(event) => updateAttributes({ orbisProps: { ...props, caption: event.target.value }, caption: event.target.value })} /></label> : null}
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

function CodeView({ node, updateAttributes }: NodeViewProps) {
  const readOnly = useContext(EditorReadOnlyContext);
  const language = String(node.attrs.language ?? "text");
  const languageItems = readOnly ? [{ value: language, label: codeLanguageLabel(language) }]
    : Object.entries({ ...CODE_LANGUAGES, [language]: codeLanguageLabel(language) }).map(([value, label]) => ({ value, label }));
  return <NodeViewWrapper as="div" data-orbis-block-id={node.attrs.orbisOwn ? undefined : node.attrs.orbisId} className="orbis-code">
    <div className="orbis-code-toolbar flex min-h-[38px] items-center justify-between gap-2 border-b border-(--reading-border) px-3.5 py-[7px]" contentEditable={false}>
      <Select value={language} disabled={readOnly} onValueChange={value => { if (value !== null) updateAttributes({ language: value }); }} items={languageItems}>
        <SelectTrigger aria-label="代码语言" size="sm" className="w-fit max-w-full border-transparent px-0 text-xs text-muted-foreground dark:bg-transparent"><SelectValue /></SelectTrigger>
        <SelectContent>{languageItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
      </Select>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="复制代码" title="复制代码" onClick={() => void copyCode(node.textContent)}><Copy aria-hidden="true" size={14} /></Button>
    </div>
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
  Placeholder.configure({ placeholder: "输入文字，或按「/」插入块…" }),
  TaskList, TaskItem.configure({ nested: true }),
  ScrollableTable.configure({ resizable: false }), TableRow, TableHeader, TableCell,
  OrbisMetadata, OrbisStyle, OrbisComponent, OrbisMedia, RetiredDrawing, OrbisBoard, OrbisToggle, OrbisToggleSummary, OrbisContainer, OrbisBlockIds, OrbisGroupEditing, OrbisCodeHighlight, OrbisMarkdownPaste,
];
