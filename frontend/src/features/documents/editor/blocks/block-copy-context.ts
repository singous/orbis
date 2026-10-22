import {createContext} from "react";
import type {Editor} from "@tiptap/core";
import type {OrbisBlock} from "../../../content/model/blocks";
import {fromTiptapDocument} from "../tiptap-model";
import {indexBlocks,normalizeBlockSelection} from "./block-tree";
import {captureBlockActionSession,prepareBlockAction} from "./block-action-read";
import {MAX_COPIED_TABLES,type DocumentCopyOrigin,type TableCopyIntent} from "../table-copy";

export type DocumentCopyPort={
  origin:()=>DocumentCopyOrigin|null;
  prepare:()=>Promise<void>;
  stage:(copies:TableCopyIntent[])=>()=>void;
  commit:()=>Promise<void>;
};
export const DocumentCopyContext=createContext<DocumentCopyPort|null>(null);
const ports=new WeakMap<Editor,DocumentCopyPort>();
export function registerDocumentCopy(editor:Editor,port:DocumentCopyPort):()=>void{
  ports.set(editor,port);return()=>{if(ports.get(editor)===port)ports.delete(editor);};
}
export function documentCopyOrigin(editor:Editor){return ports.get(editor)?.origin()??null;}
export async function prepareTablePaste(editor:Editor):Promise<void>{
  const port=ports.get(editor);
  if(!port)return;
  const current=captureBlockActionSession(editor);
  await port.prepare();
  if(!current()||ports.get(editor)!==port)throw new Error("文档已变化，请重新选择粘贴位置，原内容已保留。");
}
export function hasInitializedTables(blocks:OrbisBlock[]):boolean{
  return blocks.some(block=>block.type==="dataTable"&&typeof block.props.table_id==="string"&&!!block.props.table_id||hasInitializedTables(block.children));
}
export function selectedTableBlocks(editor:Editor,ids:string[]):boolean{
  const blocks=fromTiptapDocument(editor.state.doc).blocks,index=indexBlocks(blocks);
  return hasInitializedTables(normalizeBlockSelection(blocks,ids).map(id=>index.get(id)!.block));
}
export async function prepareTableCopy(editor:Editor,ids:string[]):Promise<void>{
  await prepareBlockAction(editor,ids);
  const port=ports.get(editor);
  if(!port||!selectedTableBlocks(editor,ids))return;
  const current=captureBlockActionSession(editor);
  await port.prepare();
  if(!current()||ports.get(editor)!==port)throw new Error("文档已变化，请重新选择后复制，原内容已保留。");
}
export function stageTableCopies(editor:Editor,sources:OrbisBlock[],targets:OrbisBlock[],origin?:DocumentCopyOrigin){
  const port=ports.get(editor);
  if(!port)return null;
  const copies:TableCopyIntent[]=[];
  const source=origin??port.origin();
  function visit(before:OrbisBlock[],after:OrbisBlock[]){
    if(before.length!==after.length)throw new Error("无法完整对应复制内容，原内容已保留。");
    for(let index=0;index<before.length;index+=1){
      const a=before[index],b=after[index];
      if(a.type==="dataTable"&&a.props.table_id&&a.id!==b.id){
        if(!source)throw new Error("无法确认表格来源快照，请重新打开来源文档后复制。");
        copies.push({block_id:b.id,source:{...source,table_id:String(a.props.table_id)}});
      }
      visit(a.children,b.children);
    }
  }
  visit(sources,targets);
  if(!copies.length)return null;
  if(copies.length>MAX_COPIED_TABLES)throw new Error("单次最多复制100个数据表，请缩小选区。");
  return {rollback:port.stage(copies),commit:port.commit};
}
