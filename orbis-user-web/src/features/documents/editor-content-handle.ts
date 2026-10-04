import type { NoteBlocksV2, OrbisBlock } from "../notes/block-model";

export type EditorContentHandle = {
  append: (blocks: OrbisBlock[]) => NoteBlocksV2;
  appendChildren: (parentId: string, blocks: OrbisBlock[]) => NoteBlocksV2;
  hydratePayload: (block: OrbisBlock) => NoteBlocksV2;
  snapshot: () => NoteBlocksV2;
  selectAll: () => void;
  selectEnd: () => void;
};
export const CONTENT_PAGE_SIZE = 32;
// Explicit whole-document actions can read larger pages. The server still
// enforces its independent 128 KiB byte budget on every response.
export const CONTENT_COMPLETION_PAGE_SIZE = 256;
export const LEGACY_CONTENT_PAGE_LIMIT = 64;
