import type { NoteBlocksV2, OrbisBlock } from "../../content/blocks";

export type BlockLoadDescriptor = {
  id: string;
  parent_id: string | null;
  child_count: number;
  has_children: boolean;
  children_loaded: boolean;
  payload_loaded: boolean;
  payload_bytes: number;
};

export type BlockLoadState = BlockLoadDescriptor & {
  cursor: string | null;
  loaded_count: number;
  loading?: boolean;
  error?: string | null;
};

/** Read metadata belongs to the session, never to user-authored block props. */
export function mergeLoadDescriptors(
  current: ReadonlyMap<string, BlockLoadState>,
  incoming: readonly BlockLoadDescriptor[],
): Map<string, BlockLoadState> {
  const next = new Map(current);
  for (const descriptor of incoming) {
    const previous = current.get(descriptor.id);
    next.set(descriptor.id, {
      ...descriptor,
      cursor: previous?.cursor ?? null,
      loaded_count: previous?.loaded_count ?? 0,
      children_loaded: previous?.children_loaded ?? descriptor.children_loaded,
      payload_loaded: previous?.payload_loaded ?? descriptor.payload_loaded,
    });
  }
  return next;
}

/** Hydrating one parent preserves every unrelated immutable branch. */
export function appendChildBlocks(content: NoteBlocksV2, parentId: string | null, incoming: OrbisBlock[], suppressed: ReadonlySet<string> = new Set()): NoteBlocksV2 {
  const known = new Set<string>();
  const collect = (items: OrbisBlock[]) => { for (const block of items) { known.add(block.id); collect(block.children); } };
  collect(content.blocks);
  const fresh = incoming.filter(block => !known.has(block.id) && !suppressed.has(block.id));
  function append(siblings: OrbisBlock[]) { return [...siblings,...fresh]; }
  if (parentId === null) return { ...content, blocks: append(content.blocks) };
  let found = false;
  function visit(siblings: OrbisBlock[]): OrbisBlock[] {
    let changed = false;
    const next = siblings.map(block => {
      if (block.id === parentId) {
        found = changed = true;
        return { ...block, children: append(block.children) };
      }
      const children = visit(block.children);
      if (children !== block.children) { changed = true; return { ...block, children }; }
      return block;
    });
    return changed ? next : siblings;
  }
  const blocks = visit(content.blocks);
  if (!found) throw new Error("内容目录已发生变化，请重新打开目标内容。");
  return { ...content, blocks };
}

export function hydrateBlockPayload(content: NoteBlocksV2, incoming: OrbisBlock): NoteBlocksV2 {
  let found = false;
  function visit(siblings: OrbisBlock[]): OrbisBlock[] {
    let changed = false;
    const next = siblings.map(block => {
      if (block.id === incoming.id) { found = changed = true; return { ...incoming, children: block.children }; }
      const children = visit(block.children);
      if (children !== block.children) { changed = true; return { ...block, children }; }
      return block;
    });
    return changed ? next : siblings;
  }
  const blocks = visit(content.blocks);
  if (!found) throw new Error("目标内容已不在当前文档中。");
  return { ...content, blocks };
}

export function hasPendingContent(states: ReadonlyMap<string, BlockLoadState>): boolean {
  return [...states.values()].some(state => !state.children_loaded || !state.payload_loaded);
}
