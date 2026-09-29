import { DOCUMENT_BLOCKS, type DocumentBlockKind } from "../content/document-components";
import { newBlockId, type OrbisBlock } from "./block-model";

const GROUP_CHILD: Partial<Record<DocumentBlockKind, DocumentBlockKind | "codeBlock">> = { cardGroup: "card", steps: "step", tabs: "tab", codeGroup: "codeBlock" };

function paragraph(): OrbisBlock { return { id: newBlockId(), type: "paragraph", props: {}, content: [], children: [] }; }

export function createDocumentBlock(kind: DocumentBlockKind | "codeBlock"): OrbisBlock {
  if (kind === "codeBlock") return { id: newBlockId(), type: kind, props: { language: "text" }, content: "", children: [] };
  const definition = DOCUMENT_BLOCKS[kind];
  const value: OrbisBlock = {
    id: newBlockId(), type: kind,
    props: Object.fromEntries(Object.entries(definition.props).map(([name, rule]) => [name, rule.default])),
    content: [], children: [],
  };
  const childKind = GROUP_CHILD[kind];
  if (childKind) {
    value.children = [createDocumentBlock(childKind), createDocumentBlock(childKind)];
    if (kind === "codeGroup") {
      value.children[0].props.language = "python";
      value.children[1].props.language = "javascript";
    } else value.children.forEach((child, index) => { child.props.title = DOCUMENT_BLOCKS[childKind as DocumentBlockKind].label + ` ${index + 1}`; });
  } else if (definition.content === "none" && kind !== "group") value.children = [paragraph()];
  return value;
}

export const INSERTABLE_DOCUMENT_BLOCKS = (Object.keys(DOCUMENT_BLOCKS) as DocumentBlockKind[]).filter((kind) => kind !== "step" && kind !== "tab");
