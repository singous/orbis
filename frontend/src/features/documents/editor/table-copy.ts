export type DocumentCopyOrigin={workspace_id:string;document_id:string;document_version:number};
export type TableCopyIntent={block_id:string;source:DocumentCopyOrigin&{table_id:string}};
export const MAX_COPIED_TABLES=100;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validID=(value:unknown):value is string=>typeof value==="string"&&UUID.test(value)&&value!=="00000000-0000-0000-0000-000000000000";
export function copyOrigin(value:unknown):DocumentCopyOrigin|null{
  if(!value||typeof value!=="object")return null;
  const origin=value as Partial<DocumentCopyOrigin>;
  if(!validID(origin.workspace_id)||!validID(origin.document_id)||!Number.isSafeInteger(origin.document_version)||(origin.document_version??0)<1)return null;
  return {workspace_id:origin.workspace_id,document_id:origin.document_id,document_version:origin.document_version!};
}
export function validTableCopies(value:unknown):value is TableCopyIntent[]{
  if(!Array.isArray(value)||value.length>MAX_COPIED_TABLES)return false;
  const ids=new Set<string>();
  return value.every(item=>{
    if(!item||typeof item!=="object"||!validID(item.block_id)||ids.has(item.block_id)||!copyOrigin(item.source)||!validID(item.source.table_id))return false;
    ids.add(item.block_id);return true;
  });
}

import type {EditorDraft} from "./editor-draft";
import type {OrbisBlock} from "../../content/model/blocks";
import {editorPayload,type NativePayload} from "../../content/codecs/api-content";
export type ResolvedCopyBlock={id:string;payload:NativePayload};
export function annotateTableCopies(draft:EditorDraft,copies:ReadonlyMap<string,TableCopyIntent>):EditorDraft{
  const visible=new Map<string,OrbisBlock>();
  const visit=(blocks:OrbisBlock[])=>{for(const block of blocks){visible.set(block.id,block);visit(block.children);}};
  visit(draft.blocks.blocks);
  return {...draft,tableCopies:[...copies.values()].filter(copy=>{const block=visible.get(copy.block_id);return block?.type==="dataTable"&&block.props.table_id===copy.source.table_id;})};
}
export function resolveTableCopies(draft:EditorDraft,copies:TableCopyIntent[],resolved:ResolvedCopyBlock[],version:number):EditorDraft{
  const source=new Map(copies.map(copy=>[copy.block_id,copy.source.table_id]));
  const replacements=new Map(resolved.map(block=>[block.id,editorPayload(block.id,block.payload)]));
  const visit=(blocks:OrbisBlock[]):OrbisBlock[]=>blocks.map(block=>{
    const replacement=replacements.get(block.id);
    if(replacement&&block.type==="dataTable"&&block.props.table_id===source.get(block.id))return {...block,props:{...block.props,table_id:replacement.props.table_id,table_revision:replacement.props.table_revision}};
    const children=visit(block.children);return children.some((child,index)=>child!==block.children[index])?{...block,children}:block;
  });
  return {...draft,version:Math.max(version,draft.version),blocks:{...draft.blocks,blocks:visit(draft.blocks.blocks)},tableCopies:draft.tableCopies?.filter(copy=>!replacements.has(copy.block_id))};
}
