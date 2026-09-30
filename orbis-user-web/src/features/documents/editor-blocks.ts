import type { NoteBlocks } from "../../shared/api/schemas";
import { isV2, toV2, type NoteBlocksV2, type OrbisBlock } from "../notes/block-model";

/** Legacy documents have no persisted block IDs. Scope deterministic path IDs
 * to their document until the next ordinary edit saves the normalized v2 tree.
 * Loading alone never writes, and existing v2 identities always remain intact. */
export function normalizeEditorBlocks(noteId: string, blocks: NoteBlocks | NoteBlocksV2): NoteBlocksV2 {
  const normalized = toV2(blocks);
  if (isV2(blocks)) return normalized;
  const prefix = `legacy-${encodeURIComponent(noteId).replaceAll("%", "_")}-`;
  const assign = (siblings: OrbisBlock[], parentPath: number[]): OrbisBlock[] => siblings.map((block, index) => {
    const path = [...parentPath, index];
    return { ...block, id: prefix + path.join("-"), children: assign(block.children, path) };
  });
  return { ...normalized, blocks: assign(normalized.blocks, []) };
}
