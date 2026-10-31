import { nativePayload, type NativeBlock, type NativePayload } from "../content/codecs/api-content";
import { createBlockChanges, type BlockChanges } from "./editor/block-changes";
import type { EditorDraft } from "./editor/editor-draft";
import type { OrbisBlock } from "../content/blocks";

export type DocumentCommand =
  | { type:"update_metadata"; title:string }
  | { type:"update_block"; block_id:string; block:NativePayload }
  | { type:"insert_blocks"; parent_id:string|null; position:number; blocks:NativeBlock[] }
  | { type:"move_block"; block_id:string; parent_id:string|null; position:number }
  | { type:"delete_block"; block_id:string; delete_subtree:true };
export type DocumentWritePlan = { kind:"commands"; operations:DocumentCommand[] } | { kind:"full" };
const MAX_COMMANDS = 100;
const MAX_INSERT_ROOTS = 100;
function entries(roots:OrbisBlock[]) {
  const result=new Map<string,{ block:OrbisBlock; parent:string|null }>();
  const visit=(blocks:OrbisBlock[],parent:string|null) => {
    for (const block of blocks) {
      if (result.has(block.id)) throw new Error("文档中存在重复内容标识，草稿仍保留。");
      result.set(block.id,{ block,parent });
      visit(block.children,block.id);
    }
  };
  visit(roots,null);
  return result;
}
/** Plan only observed edits; omitted children are never serialized as deletions. */
export function planDocumentWrite(before:EditorDraft, after:EditorDraft, complete:boolean, changes:BlockChanges = createBlockChanges()(before.blocks,after.blocks)):DocumentWritePlan {
  const operations:DocumentCommand[]=[];
  const title=after.title.trim() || "未命名文档";
  if (title !== (before.title.trim() || "未命名文档")) operations.push({ type:"update_metadata",title });
  if (!changes.upserts.length && !changes.moves.length && !changes.deletes.length) return { kind:"commands",operations };
  const previous=entries(before.blocks.blocks), current=entries(after.blocks.blocks);
  const changed=new Set(changes.upserts.map(block=>block.id));
  const moved=new Set(changes.moves.map(block=>block.id));
  const inserted=new Set<string>();
  const newTree=(block:OrbisBlock):NativeBlock => {
    inserted.add(block.id);
    return { ...nativePayload(block),id:block.id,children:block.children.filter(child=>!previous.has(child.id)).map(newTree) };
  };
  const visit=(siblings:OrbisBlock[],parent:string|null) => {
    let position=0;
    while (position<siblings.length) {
      const block=siblings[position];
      if (!previous.has(block.id) && !inserted.has(block.id)) {
        const start=position, batch:OrbisBlock[]=[];
        while (position<siblings.length && batch.length<MAX_INSERT_ROOTS && !previous.has(siblings[position].id) && !inserted.has(siblings[position].id)) batch.push(siblings[position++]);
        operations.push({ type:"insert_blocks",parent_id:parent,position:start,blocks:batch.map(newTree) });
        for (const item of batch) visit(item.children,item.id);
        continue;
      }
      if (previous.has(block.id)) {
        // Positions avoid an after-ID dependency on a sibling not yet moved to this parent.
        if (moved.has(block.id)) operations.push({ type:"move_block",block_id:block.id,parent_id:parent,position });
        if (changed.has(block.id)) operations.push({ type:"update_block",block_id:block.id,block:nativePayload(block) });
      }
      visit(block.children,block.id);
      position+=1;
    }
  };
  visit(after.blocks.blocks,null);
  const removed=new Set([...previous.keys()].filter(id=>!current.has(id)));
  for (const id of removed) {
    const parent=previous.get(id)!.parent;
    // Retained descendants have already escaped their removed parent through the moves above.
    if (parent===null || !removed.has(parent)) operations.push({ type:"delete_block",block_id:id,delete_subtree:true });
  }
  if (operations.length>MAX_COMMANDS) {
    if (complete) return { kind:"full" };
    throw new Error("当前改动较多，请先完整载入文档再保存。草稿仍保留。");
  }
  return { kind:"commands",operations };
}
