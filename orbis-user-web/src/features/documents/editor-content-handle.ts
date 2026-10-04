import type { NoteBlocksV2, OrbisBlock } from "../notes/block-model";

export type EditorContentHandle = {
  append: (blocks: OrbisBlock[]) => NoteBlocksV2;
  snapshot: () => NoteBlocksV2;
  selectAll: () => void;
  selectEnd: () => void;
};
export const CONTENT_PAGE_SIZE = 32;
