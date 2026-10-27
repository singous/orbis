import { withRequestFeedback } from "../../shared/api/request-feedback";
export {saveNoteBlockChanges} from "./document-operations-api";
import { z } from "zod";
import { ApiError,apiRequest,workspacePath } from "../../shared/api/api-client";
import { noteChildrenPageSchema,noteContentSchema,type NoteBlocks,type NoteContent } from "../../shared/api/schemas";
import { authRequestOptions,type AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { toV2 } from "../content/model/blocks";
import { editorBlock,editorPayload,nativeBlock,nativeBlockSchema,nativePayloadSchema } from "../content/codecs/api-content";
import { getNote } from "./catalog-api";

const MAX_PAGE_SIZE=100;
const MAX_OUTLINE_PAGES=100;
const revisionSchema=z.object({ document_id:z.string().uuid(),version:z.number().int().positive(),title:z.string(),title_recorded:z.boolean() });
const contentSchema=z.object({ revision:revisionSchema,blocks:z.array(nativeBlockSchema) });
const recordSchema=z.object({ id:z.string().uuid(),parent_id:z.string().uuid().nullable(),position:z.number().int().nonnegative(),payload:nativePayloadSchema.nullable(),block_type:z.string(),payload_loaded:z.boolean(),payload_bytes:z.number().int().nonnegative(),block_revision:z.number().int().positive(),child_count:z.number().int().nonnegative() }).refine(row=>row.payload_loaded ? row.payload!==null && row.payload.type===row.block_type : row.payload===null);
const cursorSchema=z.object({ next_cursor:z.string().min(1).nullable(),has_more:z.boolean() });
const windowSchema=z.object({ version:z.number().int().positive(),items:z.array(recordSchema),pagination:cursorSchema });

const documentPath=(id:string,auth:AuthRequestOptions,suffix="")=>workspacePath(auth,`/documents/${id}${suffix}`);
function query(path:string,values:Record<string,string|number|null|undefined>) {
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(values)) if(value!==null && value!==undefined) params.set(key,String(value));
  return params.size ? `${path}?${params}` : path;
}
function contentView(raw:unknown):NoteContent {
  const content=contentSchema.parse(raw);
  return noteContentSchema.parse({ kind:"complete",note_id:content.revision.document_id,content_version:content.revision.version,title:content.revision.title_recorded ? content.revision.title : null,blocks:{schema_version:2,editor:"blocknote",blocks:content.blocks.map(editorBlock)} });
}
function descriptor(row:z.infer<typeof recordSchema>) {
  return { id:row.id,parent_id:row.parent_id,child_count:row.child_count,has_children:row.child_count>0,children_loaded:row.child_count===0,payload_loaded:row.payload_loaded,payload_bytes:row.payload_bytes };
}
export async function getNoteContent(noteId:string,auth:AuthRequestOptions,signal?:AbortSignal,version?:number) {
  return contentView(await apiRequest(query(documentPath(noteId,auth,"/content"),{version}),{...authRequestOptions(auth),signal}));
}
export async function getNoteChildrenPage(noteId:string,auth:AuthRequestOptions,options:{parentId?:string|null;cursor?:string|null;limit?:number;version?:number;signal?:AbortSignal}={}) {
  const metadata=options.version===undefined ? await getNote(noteId,auth,options.signal) : null;
  const version=options.version ?? metadata!.content_version;
  const data=windowSchema.parse(await apiRequest(query(documentPath(noteId,auth,"/children"),{parent_id:options.parentId,cursor:options.cursor,page_size:Math.min(options.limit ?? 32,MAX_PAGE_SIZE),version}),{...authRequestOptions(auth),signal:options.signal}));
  if(data.version!==version)throw new ApiError(502,"正文分页版本不一致，请重新载入。","API_RESPONSE_INVALID");
  return noteChildrenPageSchema.parse({ kind:"children",note_id:noteId,content_version:data.version,title:metadata?.title ?? null,parent_id:options.parentId ?? null,blocks:{schema_version:2,editor:"blocknote",blocks:data.items.map(item=>item.payload_loaded && item.payload ? editorPayload(item.id,item.payload) : {id:item.id,type:item.block_type,props:{},content:[],children:[]})},next_cursor:data.pagination.next_cursor,has_more:data.pagination.has_more,read_position:data.items.length ? data.items[data.items.length-1].position+1 : 0,descriptors:data.items.map(descriptor) });
}
export async function getNoteBlock(noteId:string,blockId:string,version:number,auth:AuthRequestOptions,signal?:AbortSignal) {
  const data=z.object({version:z.number().int().positive(),item:recordSchema}).parse(await apiRequest(query(documentPath(noteId,auth,`/blocks/${blockId}`),{version}),{...authRequestOptions(auth),signal}));
  if(data.version!==version || !data.item.payload_loaded || !data.item.payload)throw new ApiError(502,"内容块响应不完整，请重新载入。","API_RESPONSE_INVALID");
  return { note_id:noteId,content_version:data.version,block:editorPayload(data.item.id,data.item.payload),descriptor:descriptor(data.item),parent_id:data.item.parent_id,position:data.item.position };
}
export function isBoundedContentPage(value:unknown):value is z.infer<typeof noteChildrenPageSchema> {
  return Boolean(value && typeof value==="object" && "descriptors" in value && Array.isArray(value.descriptors));
}
export async function getNoteContentOutline(noteId:string,version:number,auth:AuthRequestOptions,signal?:AbortSignal) {
  const schema=z.object({version:z.number().int().positive(),items:z.array(z.object({id:z.string().uuid(),text:z.string(),level:z.number().int(),parent_id:z.string().uuid().nullable(),root_position:z.number().int().nonnegative()})),pagination:cursorSchema});
  const items:Array<{id:string;text:string;level:number;parent_id:string|null;root_index:number}>=[];
  let cursor:string|null=null;
  for(let page=0;page<MAX_OUTLINE_PAGES;page+=1) {
    const result=schema.parse(await apiRequest(query(documentPath(noteId,auth,"/outline"),{version,cursor,page_size:MAX_PAGE_SIZE}),{...authRequestOptions(auth),signal}));
    if(result.version!==version)throw new ApiError(502,"大纲版本不一致，请重新载入。","API_RESPONSE_INVALID");
    items.push(...result.items.map(item=>({...item,root_index:item.root_position})));
    if(!result.pagination.has_more) return {content_version:result.version,items};
    cursor=result.pagination.next_cursor;
    if(!cursor) throw new ApiError(502,"大纲分页响应不完整。","API_RESPONSE_INVALID");
  }
  throw new Error("文档大纲超过加载上限，请缩小范围。");
}
function uncertain(error:unknown) { return !(error instanceof ApiError) || error.status>=500 || error.status===0; }

export async function saveNoteContent(payload:{noteId:string;expectedVersion:number;operationId:string;title:string;blocks:NoteBlocks},auth:AuthRequestOptions) {
  return withRequestFeedback(auth, async auth => {
  const body={operation_id:payload.operationId,expected_version:payload.expectedVersion,title:payload.title.trim() || "未命名文档",blocks:toV2(payload.blocks).blocks.map(nativeBlock)};
  let wasUncertain=false;
  for(let attempt=0;attempt<2;attempt+=1) {
    try {return contentView(await apiRequest(documentPath(payload.noteId,auth,"/content"),{...authRequestOptions(auth),method:"PUT",body}));}
    catch(error) {
      if(!uncertain(error) && !wasUncertain) throw error;
      wasUncertain=true;
      if(attempt===1 || !uncertain(error)) throw new ApiError(503, "上次保存结果尚未确认，请重试原来的保存。草稿仍保留。", "DOCUMENT_WRITE_RESULT_UNKNOWN", "", {operation_id:payload.operationId}, { cause: error });
    }
  }
  throw new Error("Unreachable content write recovery");

  });
}
