import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs, type PropSchema } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { BookOpen, Code2, Info, Layers, ListOrdered, Plus } from "lucide-react";
import { createContext, useContext } from "react";

import { CODE_LANGUAGES } from "../content/CodeBlock";
import { DOCUMENT_BLOCKS, documentBlockDefinition, documentBlockTitle, type DocumentBlockKind } from "../content/document-components";
import { newBlockId, type OrbisBlock } from "./block-model";
import { documentGroupEditing } from "./document-group-editing";
import "../../styles/document-editor.css";

export const DocumentEditorReadOnly = createContext(true);
const GROUP_CHILD: Partial<Record<DocumentBlockKind, DocumentBlockKind | "codeBlock">> = { cardGroup: "card", steps: "step", tabs: "tab", codeGroup: "codeBlock" };
const PROP_LABELS: Record<string, string> = { title: "标题", href: "链接", tone: "提示类型", columns: "每行卡片数量" };
const VALUE_LABELS: Record<string, string> = { info: "说明", success: "成功", warning: "注意", danger: "警告" };

function paragraph(): OrbisBlock {
  return { id: newBlockId(), type: "paragraph", props: {}, content: [], children: [] };
}

export function createDocumentBlock(kind: DocumentBlockKind | "codeBlock"): OrbisBlock {
  if (kind === "codeBlock") return { id: newBlockId(), type: kind, props: { language: "text" }, content: "", children: [] };
  const definition = DOCUMENT_BLOCKS[kind];
  const block: OrbisBlock = {
    id: newBlockId(), type: kind,
    props: Object.fromEntries(Object.entries(definition.props).map(([name, rule]) => [name, rule.default])),
    content: [], children: [],
  };
  const childKind = GROUP_CHILD[kind];
  if (childKind) {
    block.children = [createDocumentBlock(childKind), createDocumentBlock(childKind)];
    if (kind === "codeGroup") {
      block.children[0].props.language = "python";
      block.children[1].props.language = "javascript";
    } else {
      block.children.forEach((child, index) => { child.props.title = DOCUMENT_BLOCKS[childKind as DocumentBlockKind].label + " " + (index + 1); });
    }
  } else if (definition.content === "none") block.children = [paragraph()];
  return block;
}

function ComponentEditor({ kind, props, contentRef, updateProps, addChild }: {
  kind: DocumentBlockKind;
  props: Record<string, unknown>;
  contentRef?: (element: HTMLElement | null) => void;
  updateProps: (patch: Record<string, string | number>) => void;
  addChild: () => void;
}) {
  const readOnly = useContext(DocumentEditorReadOnly);
  const definition = DOCUMENT_BLOCKS[kind];
  const title = documentBlockTitle({ type: kind, props });
  const Icon = kind === "callout" ? Info : kind === "steps" || kind === "step" ? ListOrdered : kind === "codeGroup" ? Code2 : kind === "tabs" || kind === "tab" ? Layers : BookOpen;
  return <div className={"doc-editor-block doc-editor-" + kind}>
    <div className="doc-editor-heading" contentEditable={false}><Icon size={15} aria-hidden="true" /><span>{definition.label}</span></div>
    {readOnly ? (title ? <strong contentEditable={false} className="doc-editor-title">{title}</strong> : null) : <div className="doc-editor-controls" contentEditable={false} onKeyDown={(event) => event.stopPropagation()}>
      {Object.entries(definition.props).map(([name, rule]) => {
        const label = name === "title" ? definition.label + "标题" : PROP_LABELS[name] || name;
        return <label key={name}><span>{label}</span>{rule.values ? <select aria-label={label} value={String(props[name] ?? rule.default)} onChange={(event) => updateProps({ [name]: typeof rule.default === "number" ? Number(event.target.value) : event.target.value })}>
          {rule.values.map((value) => <option key={value} value={value}>{VALUE_LABELS[String(value)] || String(value)}</option>)}
        </select> : <input aria-label={label} maxLength={rule.maxLength} value={String(props[name] ?? rule.default)}
          placeholder={name === "href" ? "https://… 或内部文档链接" : "输入标题"}
          onChange={(event) => updateProps({ [name]: event.target.value })} />}</label>;
      })}
      {GROUP_CHILD[kind] ? <button type="button" onClick={addChild}><Plus size={13} aria-hidden="true" />添加{kind === "codeGroup" ? "代码示例" : DOCUMENT_BLOCKS[GROUP_CHILD[kind] as DocumentBlockKind].label}</button> : null}
    </div>}
    {definition.content === "inline" ? <div ref={contentRef} className="doc-editor-inline" /> : null}
  </div>;
}

function componentSpec(kind: DocumentBlockKind) {
  const definition = DOCUMENT_BLOCKS[kind];
  const propSchema = Object.fromEntries(Object.entries(definition.props).map(([name, rule]) => [name, {
    default: rule.default, ...(rule.values ? { values: rule.values } : {}),
  }])) as PropSchema;
  return createReactBlockSpec({ type: kind, propSchema, content: definition.content }, {
    render: (renderProps) => {
      const { block, editor } = renderProps;
      // BlockNote's generic props cannot describe this runtime-loaded mixed
      // registry. Keep the typed JSON-to-editor bridge at this one boundary.
      const update = (value: { props?: Record<string, string | number>; children?: unknown[] }) =>
        editor.updateBlock(block, value as unknown as Parameters<typeof editor.updateBlock>[1]);
      // The registry is dynamic; contentRef exists only for inline specifications.
      const contentRef = (renderProps as { contentRef?: (element: HTMLElement | null) => void }).contentRef;
      return <ComponentEditor kind={kind} props={block.props} contentRef={contentRef}
        updateProps={(patch) => update({ props: patch })}
        addChild={() => {
          const childKind = GROUP_CHILD[kind];
          if (!childKind) return;
          const current = editor.getBlock(block.id);
          if (!current) return;
          const child = createDocumentBlock(childKind);
          update({ children: [...current.children, child] });
        }} />;
    },
    toExternalHTML: (renderProps) => {
      const title = documentBlockTitle({ type: kind, props: renderProps.block.props });
      const contentRef = (renderProps as { contentRef?: (element: HTMLElement | null) => void }).contentRef;
      return <section data-document-component={kind}>{title ? <strong>{title}</strong> : null}{definition.content === "inline" ? <div ref={contentRef} /> : null}</section>;
    },
  })();
}

const componentSpecs = Object.fromEntries((Object.keys(DOCUMENT_BLOCKS) as DocumentBlockKind[]).map((kind) => [kind, componentSpec(kind)])) as Record<DocumentBlockKind, ReturnType<typeof componentSpec>>;

function editableCodeSpec() {
  const spec = createCodeBlockSpec({ supportedLanguages: Object.fromEntries(Object.entries(CODE_LANGUAGES).map(([name, label]) => [name, { name: label }])) });
  const original = spec.implementation.render;
  const render: typeof original = function (block, editor) {
    const result = original.call(this, block, editor);
    const select = result.dom.querySelector("select");
    if (select) {
      select.setAttribute("aria-label", "代码语言");
      const language = block.props.language;
      if (language && !Object.hasOwn(CODE_LANGUAGES, language)) {
        const option = document.createElement("option");
        option.value = language;
        option.textContent = language;
        select.appendChild(option);
        select.value = language;
      }
    }
    return result;
  };
  return { ...spec, implementation: { ...spec.implementation, render } };
}

export const documentEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    ...componentSpecs,
    codeBlock: editableCodeSpec(),
  },
});
export const documentEditorExtensions = [documentGroupEditing()];
export type DocumentEditor = typeof documentEditorSchema.BlockNoteEditor;
export const INSERTABLE_DOCUMENT_BLOCKS = (Object.keys(DOCUMENT_BLOCKS) as DocumentBlockKind[]).filter((kind) => kind !== "step" && kind !== "tab");
export { documentBlockDefinition };
