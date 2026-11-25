import * as Y from "yjs";

/**
 * Classify the applied transaction, using only the server's merged state.
 * Edits to existing root paragraph/heading text and presentation properties
 * preserve order and block IDs.
 * Any other mutation requires rebuilding the complete native projection.
 */
export function applyUpdateAndFindTextBlocks(doc: Y.Doc, update: Uint8Array): string[] | undefined {
  const body = doc.getXmlFragment("body");
  let transactions = 0;
  let affected: string[] | undefined;
  const inspect = ({ changed }: Y.Transaction) => {
    transactions += 1;
    const ids = new Set<string>();
    for (const [type, keys] of changed) {
      let block;
      if (type instanceof Y.XmlText && keys.size === 1 && keys.has(null) && !type._item?.deleted) {
        block = type.parent;
      } else if (type instanceof Y.XmlElement && keys.size === 1 && keys.has("orbisProps")) {
        // The ProseMirror binding can rewrite the same property map during typing.
        block = type;
      } else {
        return;
      }
      if (!(block instanceof Y.XmlElement) || block.parent !== body || block._item?.deleted ||
        !["paragraph", "heading"].includes(block.nodeName) || block.getAttribute("orbisOwn")) return;
      const id = block.getAttribute("orbisId");
      if (typeof id !== "string" || !id) return;
      ids.add(id);
    }
    affected = ids.size ? [...ids] : undefined;
  };
  doc.on("afterTransaction", inspect);
  try {
    Y.applyUpdate(doc, update);
    // A fixup transaction may incorporate changes absent from the first event.
    return transactions === 1 ? affected : undefined;
  } finally {
    doc.off("afterTransaction", inspect);
  }
}
