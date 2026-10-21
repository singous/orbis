import type {TableCopyIntent} from "./table-copy";
import { canonicalJSON, type NoteBlocksV2, type OrbisBlock } from "../../content/model/blocks";

export type EditorDraft = { title: string; blocks: NoteBlocksV2; version: number;tableCopies?:TableCopyIntent[] };

/** Cache immutable branches without retaining documents after their session ends.
 * The exact signature preserves undo-to-saved detection without hash collisions. */
export function createEditorDraftFingerprint() {
  const blockSignatures = new WeakMap<OrbisBlock, string>();
  const documentSignatures = new WeakMap<NoteBlocksV2, string>();
  function blockSignature(block: OrbisBlock): string {
    const cached = blockSignatures.get(block);
    if (cached !== undefined) return cached;
    const { children, ...own } = block;
    const result = `[${canonicalJSON(own)},[${children.map(blockSignature).join(",")}]]`;
    blockSignatures.set(block, result);
    return result;
  }
  function contentSignature(content: NoteBlocksV2): string {
    const cached = documentSignatures.get(content);
    if (cached !== undefined) return cached;
    const { blocks, ...envelope } = content;
    const result = `[${canonicalJSON(envelope)},[${blocks.map(blockSignature).join(",")}]]`;
    documentSignatures.set(content, result);
    return result;
  }
  return (draft: EditorDraft): string => `[${JSON.stringify(draft.title.trim() || "未命名文档")},${contentSignature(draft.blocks)},${canonicalJSON(draft.tableCopies??[])}]`;
}
