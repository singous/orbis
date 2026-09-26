import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { newBlockId } from "./block-model";

const OWNED_BLOCKS = new Set([
  "paragraph", "heading", "codeBlock", "horizontalRule", "blockquote", "listItem", "taskItem",
  "table", "orbisComponent", "orbisMedia", "orbisToggle", "orbisContainer",
]);
const SYNTHETIC_PARAGRAPH_PARENTS = new Set(["listItem", "taskItem", "tableCell", "tableHeader"]);

/** New Tiptap nodes need stable Orbis IDs before an autosave is emitted. */
export const OrbisBlockIds = Extension.create({
  name: "orbisBlockIds",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("orbisBlockIds"),
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        const transaction = state.tr;
        state.doc.descendants((node, pos, parent) => {
          if (!OWNED_BLOCKS.has(node.type.name) || node.attrs.orbisId) return;
          if (node.type.name === "paragraph" && (node.attrs.orbisOwn || SYNTHETIC_PARAGRAPH_PARENTS.has(parent?.type.name ?? ""))) return;
          transaction.setNodeMarkup(pos, undefined, { ...node.attrs, orbisId: newBlockId() });
        });
        return transaction.docChanged ? transaction : null;
      },
    })];
  },
});
