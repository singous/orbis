import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";

import { newBlockId } from "./block-model";

const OWNED_BLOCKS = new Set([
  "paragraph", "heading", "codeBlock", "horizontalRule", "blockquote", "listItem", "taskItem",
  "table", "orbisComponent", "orbisMedia", "orbisToggle", "orbisContainer",
]);
const SYNTHETIC_PARAGRAPH_PARENTS = new Set(["listItem", "taskItem", "tableCell", "tableHeader"]);
const OWN_CONTENT_PARENTS = new Set(["orbisComponent", "orbisToggle", "blockquote"]);
// IDs must be unique before group normalization restores a selection by ID.
const BLOCK_ID_PRIORITY = 110;

function persistedNodes(doc: PMNode, idsByPosition?: Map<number, unknown>): Array<{ node: PMNode; pos: number }> {
  const result: Array<{ node: PMNode; pos: number }> = [];
  doc.descendants((node, pos, parent, index) => {
    idsByPosition?.set(pos, node.attrs.orbisId);
    if (!OWNED_BLOCKS.has(node.type.name)) return;
    const containerHead = parent?.type.name === "orbisContainer" && index === 0;
    const ownContent = node.attrs.orbisOwn && index === 0 && OWN_CONTENT_PARENTS.has(parent?.type.name ?? "");
    const syntheticParagraph = node.type.name === "paragraph" && (ownContent || (SYNTHETIC_PARAGRAPH_PARENTS.has(parent?.type.name ?? "") && (index === 0 || ["tableCell", "tableHeader"].includes(parent?.type.name ?? ""))));
    if (!containerHead && !syntheticParagraph) result.push({ node, pos });
    // Table cell blocks are persisted as inline content, not independent blocks.
    if (node.type.name === "table") {
      if (idsByPosition) node.descendants((child, offset) => { idsByPosition.set(pos + 1 + offset, child.attrs.orbisId); });
      return false;
    }
  });
  return result;
}

/** New Tiptap nodes need stable Orbis IDs before an autosave is emitted. */
export const OrbisBlockIds = Extension.create({
  name: "orbisBlockIds",
  priority: BLOCK_ID_PRIORITY,
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("orbisBlockIds"),
      appendTransaction(transactions, oldState, state) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        const mapping = new Mapping();
        transactions.forEach((transaction) => mapping.appendMapping(transaction.mapping));
        // Resolve mapped positions once. Repeated nodeAt on a flat document
        // searches sibling offsets for every retained block.
        const idsByPosition = new Map<number, unknown>();
        const nodes = persistedNodes(state.doc, idsByPosition);
        const retained = new Map<string, number>();
        for (const { node, pos } of persistedNodes(oldState.doc)) {
          const id = node.attrs.orbisId;
          const mapped = mapping.map(pos);
          if (typeof id === "string" && id && !retained.has(id) && idsByPosition.get(mapped) === id) retained.set(id, mapped);
        }
        const reserved = new Set<string>(nodes.map(({ node }) => node.attrs.orbisId).filter((id): id is string => typeof id === "string" && Boolean(id)));
        const seen = new Set<string>();
        const transaction = state.tr;
        for (const { node, pos } of nodes) {
          const previous = node.attrs.orbisId;
          const duplicate = seen.has(previous) || (retained.has(previous) && retained.get(previous) !== pos);
          let id = previous;
          if (typeof id !== "string" || !id || duplicate) {
            do { id = newBlockId(); } while (reserved.has(id));
            reserved.add(id);
            transaction.setNodeMarkup(pos, undefined, { ...node.attrs, orbisId: id });
          }
          seen.add(id);
          // The first child is the editable head of this same stored block.
          if (node.type.name === "orbisContainer" && node.firstChild && node.firstChild.attrs.orbisId !== id) {
            transaction.setNodeMarkup(pos + 1, undefined, { ...node.firstChild.attrs, orbisId: id });
          }
        }
        return transaction.docChanged ? transaction : null;
      },
    })];
  },
});
