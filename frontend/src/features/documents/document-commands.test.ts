import { expect,it } from "vitest";
import { planDocumentWrite } from "./document-commands";
import type { OrbisBlock } from "../content/blocks";
import type { EditorDraft } from "./editor/editor-draft";
const block=(text:string,children:OrbisBlock[]=[]):OrbisBlock=>({ id:crypto.randomUUID(),type:children.length ? "group" : "paragraph",props:{},content:children.length ? [] : [{type:"text",text}],children });
const draft=(blocks:OrbisBlock[],title="文档"):EditorDraft=>({title,blocks:{schema_version:2,editor:"blocknote",blocks},version:2});
it("updates a shallow parent without asserting that its unseen children are empty",()=>{
  const before=block("原文");
  const plan=planDocumentWrite(draft([before]),draft([{...before,content:[{type:"text",text:"修改后"}]}]),false);
  expect(plan.kind).toBe("commands");
  if(plan.kind!=="commands") throw new Error("unexpected full write");
  expect(plan.operations).toHaveLength(1);
  expect(plan.operations[0]).toMatchObject({type:"update_block",block_id:before.id});
  expect(plan.operations[0]).not.toHaveProperty("block.children");
});
it("moves a retained child out before deleting its old parent and inserts it only once",()=>{
  const child=block("保留内容"),old=block("",[child]),target=block("",[child]);
  const plan=planDocumentWrite(draft([old]),draft([target]),true);
  if(plan.kind!=="commands") throw new Error("unexpected full write");
  expect(plan.operations.map(item=>item.type)).toEqual(["insert_blocks","move_block","delete_block"]);
  expect(plan.operations[0]).toMatchObject({type:"insert_blocks",blocks:[{id:target.id,children:[]}]});
  expect(plan.operations[1]).toMatchObject({type:"move_block",block_id:child.id,parent_id:target.id,position:0});
  expect(plan.operations[2]).toMatchObject({block_id:old.id,delete_subtree:true});
});
it("groups large pastes without duplicating nested new blocks",()=>{
  const roots=Array.from({length:250},(_,i)=>block(String(i),i===0 ? [block("嵌套")] : []));
  const plan=planDocumentWrite(draft([]),draft(roots),true);
  if(plan.kind!=="commands") throw new Error("unexpected full write");
  expect(plan.operations).toHaveLength(3);
  expect(plan.operations.map(item=>item.type==="insert_blocks" ? item.blocks.length : 0)).toEqual([100,100,50]);
  expect(plan.operations[0]).toMatchObject({position:0,blocks:[expect.objectContaining({children:[expect.objectContaining({id:roots[0].children[0].id})]}),...roots.slice(1,100).map(item=>expect.objectContaining({id:item.id}))]});
});
it("deletes only the removed subtree root",()=>{
  const parent=block("",[block("子内容")]);
  const plan=planDocumentWrite(draft([parent]),draft([]),true);
  expect(plan).toEqual({kind:"commands",operations:[{type:"delete_block",block_id:parent.id,delete_subtree:true}]});
});
it("uses a complete snapshot for an oversized diff and preserves partial drafts",()=>{
  const before=Array.from({length:101},()=>block("原文"));
  const after=before.map(item=>({...item,content:[{type:"text" as const,text:"更新"}]}));
  expect(planDocumentWrite(draft(before),draft(after),true)).toEqual({kind:"full"});
  expect(()=>planDocumentWrite(draft(before),draft(after),false)).toThrow("草稿仍保留");
});
it("combines title and body into one command plan and treats a blank title consistently",()=>{
  const first=block("原文");
  const plan=planDocumentWrite(draft([first]),draft([{...first,content:[{type:"text",text:"更新"}]}],"新标题"),false);
  if(plan.kind!=="commands") throw new Error("unexpected full write");
  expect(plan.operations.map(item=>item.type)).toEqual(["update_metadata","update_block"]);
  expect(planDocumentWrite(draft([],"未命名文档"),draft([]," "),true)).toEqual({kind:"commands",operations:[]});
});
