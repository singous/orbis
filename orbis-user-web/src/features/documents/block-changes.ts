import { canonicalJSON, type NoteBlocksV2, type OrbisBlock } from "../notes/block-model";

export type BlockChanges = {
  upserts: Array<Omit<OrbisBlock, "children">>;
  moves: Array<{ id: string; parent_id: string | null; after_id: string | null }>;
  deletes: string[];
};

type Entry = { block: OrbisBlock; parent: string | null; after: string | null };

/** Loading extends both autosave baselines; only user edits appear in this diff. */
export function createBlockChanges() {
  const signatures = new WeakMap<OrbisBlock, string>();
  function ownSignature(block: OrbisBlock) {
    let signature = signatures.get(block);
    if (signature === undefined) {
      const { children: _children, ...own } = block;
      signature = canonicalJSON(own);
      signatures.set(block, signature);
    }
    return signature;
  }
  function entries(document: NoteBlocksV2) {
    const map = new Map<string, Entry>();
    function visit(siblings: OrbisBlock[], parent: string | null) {
      let after: string | null = null;
      for (const block of siblings) {
        if (map.has(block.id)) throw new Error("文档中存在重复的内容块标识，当前草稿仍保留。");
        map.set(block.id, { block, parent, after });
        visit(block.children, block.id);
        after = block.id;
      }
    }
    visit(document.blocks, null);
    return map;
  }
  return (before: NoteBlocksV2, after: NoteBlocksV2): BlockChanges => {
    const previous = entries(before), current = entries(after);
    const result: BlockChanges = { upserts: [], moves: [], deletes: [] };
    for (const [id, entry] of current) {
      const old = previous.get(id);
      if (!old || ownSignature(old.block) !== ownSignature(entry.block)) {
        const { children: _children, ...payload } = entry.block;
        result.upserts.push(payload);
      }
      if (!old || old.parent !== entry.parent || old.after !== entry.after) result.moves.push({ id, parent_id: entry.parent, after_id: entry.after });
    }
    for (const id of previous.keys()) if (!current.has(id)) result.deletes.push(id);
    return result;
  };
}
