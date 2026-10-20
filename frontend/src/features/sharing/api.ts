import {z} from "zod";
import {ApiError,apiBlobRequest,apiRequest,workspacePath} from "../../shared/api/api-client";
import {paginationSchema} from "../../shared/api/schemas";
import {authRequestOptions,type AuthRequestOptions} from "../../shared/auth/use-auth-request";
import {publicBlockSchema,publicEditorBlock} from "../content/codecs/public-content";
import {editorPayload} from "../content/codecs/api-content";
import {SHARED_CONTENT_PAGE_SIZE} from "./sharing-config";
const shareSchema=z.object({id:z.string().uuid(),collection_id:z.string().uuid(),root_document_id:z.string().uuid().nullable(),version:z.number().int().positive(),created_at_ms:z.number().int(),revoked_at_ms:z.number().int().nullable(),expires_at_ms:z.number().int().nullable(),path:z.string().nullable()}).transform(value=>({...value,notebook_id:value.collection_id,root_note_id:value.root_document_id}));
export type DocumentShare=z.infer<typeof shareSchema>;
export type ShareTarget={notebookId:string;noteId?:string;title:string};
const directoryNode=z.object({id:z.string().uuid(),parent_id:z.string().uuid().nullable(),title:z.string(),position:z.number().int().nonnegative(),content_version:z.number().int().positive(),updated_at_ms:z.number().int()}).transform(value=>({...value,sort_order:value.position}));
export const publicShareSchema=z.object({title:z.string(),root_document_id:z.string().uuid().nullable(),directory_version:z.number().int().positive(),items:z.array(directoryNode),pagination:paginationSchema}).transform(value=>({...value,root_note_id:value.root_document_id}));
export type PublicShare=z.infer<typeof publicShareSchema>;
const documentSchema=z.object({id:z.string().uuid(),title:z.string(),content_version:z.number().int().positive(),updated_at_ms:z.number().int()});
const descriptorSchema=z.object({id:z.string().uuid(),parent_id:z.string().uuid().nullable(),child_count:z.number().int().nonnegative(),payload_loaded:z.boolean(),payload_bytes:z.number().int().nonnegative()}).transform(value=>({...value,has_children:value.child_count>0,children_loaded:value.child_count===0}));
const rowSchema=z.object({id:z.string().uuid(),parent_id:z.string().uuid().nullable(),position:z.number().int().nonnegative(),block_type:z.string(),child_count:z.number().int().nonnegative(),payload_bytes:z.number().int().nonnegative(),payload_loaded:z.boolean(),block:publicBlockSchema.nullable()}).refine(value=>value.payload_loaded?value.block!==null:value.block===null);
export type SharedContentPage={note_id:string;title:string;blocks:{schema_version:2;editor:"blocknote";blocks:Array<Record<string,unknown>>};content_version:number;updated_at_ms:number;parent_id:string|null;next_cursor:string|null;has_more:boolean;descriptors:Array<z.infer<typeof descriptorSchema>>};
export type SharedBlock={id:string;parent_id:string|null;position:number;content_version:number;block:ReturnType<typeof publicEditorBlock>};
const publicBase=(token:string)=>`/v1/public/shares/${encodeURIComponent(token)}`;
export async function listShares(target:ShareTarget,auth:AuthRequestOptions){
  const items:DocumentShare[]=[];
  for(let page=1;page<=100;page+=1){
    const params=new URLSearchParams({collection_id:target.notebookId,page:String(page),page_size:"100"});if(target.noteId)params.set("root_document_id",target.noteId);
    const data=z.object({items:z.array(shareSchema),pagination:paginationSchema}).parse(await apiRequest(workspacePath(auth,`/shares?${params}`),authRequestOptions(auth)));
    items.push(...data.items);if(!data.pagination.has_next)return items;
  }
  throw new Error("分享链接数量超过加载上限，请缩小范围。");
}
export async function createShare(target:ShareTarget,auth:AuthRequestOptions){
  const data=z.object({share:shareSchema,path:z.string(),token:z.string()}).parse(await apiRequest(workspacePath(auth,"/shares"),{...authRequestOptions(auth),method:"POST",body:{collection_id:target.notebookId,root_document_id:target.noteId??null,acknowledge_public_scope:true}}));
  return {...data.share,path:data.path,token:data.token};
}
export async function revokeShare(id:string,expectedVersion:number,auth:AuthRequestOptions){return shareSchema.parse(await apiRequest(workspacePath(auth,`/shares/${id}/revoke`),{...authRequestOptions(auth),method:"POST",body:{expected_version:expectedVersion}}));}
export async function readPublicShare(token:string,signal?:AbortSignal,options:{parentId?:string;page?:number;directoryVersion?:number}={}){
  const params=new URLSearchParams({page:String(options.page??1),page_size:"20"});if(options.parentId)params.set("parent_id",options.parentId);if(options.directoryVersion)params.set("directory_version",String(options.directoryVersion));
  return publicShareSchema.parse(await apiRequest(`${publicBase(token)}/directory?${params}`,{signal}));
}
export async function readSharedDocument(token:string,id:string,signal?:AbortSignal){return documentSchema.parse(await apiRequest(`${publicBase(token)}/documents/${id}`,{signal}));}
export async function readSharedContent(token:string,id:string,options:{parentId?:string;cursor?:string|null;version?:number;signal?:AbortSignal}={}):Promise<SharedContentPage>{
  const params=new URLSearchParams({page_size:String(SHARED_CONTENT_PAGE_SIZE)});if(options.parentId)params.set("parent_id",options.parentId);if(options.cursor)params.set("cursor",options.cursor);if(options.version)params.set("version",String(options.version));
  const data=z.object({document:documentSchema,items:z.array(rowSchema),pagination:z.object({next_cursor:z.string().min(1).nullable(),has_more:z.boolean()})}).parse(await apiRequest(`${publicBase(token)}/documents/${id}/children?${params}`,{signal:options.signal}));
  if(data.document.id!==id||options.version!==undefined&&data.document.content_version!==options.version)throw new ApiError(409,"分享正文已更新，请重新读取。","SHARE_CONTENT_CHANGED");
  return {note_id:id,title:data.document.title,content_version:data.document.content_version,updated_at_ms:data.document.updated_at_ms,parent_id:options.parentId??null,next_cursor:data.pagination.next_cursor,has_more:data.pagination.has_more,descriptors:data.items.map(item=>descriptorSchema.parse(item)),blocks:{schema_version:2,editor:"blocknote",blocks:data.items.map(item=>item.block?publicEditorBlock(item.block):editorPayload(item.id,{type:item.block_type,props:{},content:[]}))}};
}
export function readSharedFile(token:string,id:string,fileId:string,signal?:AbortSignal){return apiBlobRequest(`${publicBase(token)}/documents/${id}/assets/${fileId}`,{signal});}
export async function readSharedBlock(token:string,id:string,blockId:string,version:number,signal?:AbortSignal):Promise<SharedBlock>{
  const value=z.object({id:z.string().uuid(),parent_id:z.string().uuid().nullable(),position:z.number().int(),block:publicBlockSchema}).parse(await apiRequest(`${publicBase(token)}/documents/${id}/blocks/${blockId}?version=${version}`,{signal}));
  return {...value,content_version:version,block:publicEditorBlock(value.block)};
}
