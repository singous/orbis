import type {DocumentCopyOrigin} from "../table-copy";
import { newBlockId, type OrbisBlock } from "../../../content/blocks";

export type BlockAddress = { id: string; block: OrbisBlock; parentId: string | null; index: number; path: number[] };
export type BlockAction =
  | { type: "delete" | "duplicate" | "up" | "down" | "indent" | "outdent" | "ungroup" }
  | { type: "insert"; side: "before" | "after" }
  | { type: "move"; targetId: string; placement: "before" | "after" | "inside" }
  | { type: "convert"; target: string; level?: number }
  | { type: "group"; kind?: string }
  | { type: "paste"; blocks: OrbisBlock[]; side?: "before" | "after"; preserveIds?: boolean; origin?:DocumentCopyOrigin; preventAutolink?:boolean };

export function indexBlocks(blocks: OrbisBlock[]): Map<string, BlockAddress> {
  const result = new Map<string, BlockAddress>();
  const visit = (siblings: OrbisBlock[], parentId: string | null, path: number[]) => siblings.forEach((block, index) => {
    result.set(block.id, { id: block.id, block, parentId, index, path: [...path, index] });
    visit(block.children, block.id, [...path, index]);
  });
  visit(blocks, null, []); return result;
}

export function normalizeBlockSelection(blocks: OrbisBlock[], ids: string[]): string[] {
  const selected = new Set(ids); const result: string[] = [];
  const visit = (siblings: OrbisBlock[]) => siblings.forEach((block) => {
    if (selected.has(block.id)) result.push(block.id);
    else visit(block.children);
  });
  visit(blocks); return result;
}

/** Copy on write keeps unmodified branches available to PM's node reuse bridge. */
export function mapBlockTree(blocks: OrbisBlock[], transform: (block: OrbisBlock) => OrbisBlock[]): OrbisBlock[] {
  let changed = false;
  const result = blocks.flatMap((block) => {
    const children = mapBlockTree(block.children, transform);
    const next = children === block.children ? block : { ...block, children };
    const replacement = transform(next);
    if (replacement.length !== 1 || replacement[0] !== block) changed = true;
    return replacement;
  });
  return changed ? result : blocks;
}

export function editBlockChildren(blocks: OrbisBlock[], parentId: string | null, edit: (children: OrbisBlock[]) => OrbisBlock[]): OrbisBlock[] {
  if (parentId === null) return edit(blocks);
  return mapBlockTree(blocks, (block) => {
    if (block.id !== parentId) return [block];
    const children = edit(block.children);
    return [children === block.children ? block : { ...block, children }];
  });
}

export function cloneBlockTree(block: OrbisBlock): OrbisBlock {
  return { ...structuredClone(block), id: newBlockId(), children: block.children.map(cloneBlockTree) };
}

export function emptyParagraph(): OrbisBlock {
  return { id: newBlockId(), type: "paragraph", props: {}, content: [], children: [] };
}
