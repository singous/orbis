import { withRequestFeedback } from "../../shared/api/request-feedback";
import {z} from "zod";
import {ApiError,apiBlobRequest,apiRequest,workspacePath} from "../../shared/api/api-client";
import {paginationSchema} from "../../shared/api/schemas";
import {authRequestOptions,type AuthRequestOptions} from "../../shared/auth/use-auth-request";
import {TABLE_PAGE_SIZE,type TableChanges,type TableMutation,type TablePage,type TableDefinition} from "./model";
import type {OrbisBlock} from "../content/blocks";

const cellSchema=z.union([z.string(),z.number().finite(),z.boolean(),z.array(z.string()),z.null()]);
const optionSchema=z.object({id:z.string().uuid(),label:z.string(),color:z.string()});
const fieldSchema=z.object({id:z.string().uuid(),name:z.string(),kind:z.enum(["text","number","select","multi_select","datetime","checkbox","url"]),options:z.array(optionSchema)});
const viewSchema=z.object({id:z.string().uuid(),name:z.string(),kind:z.enum(["grid","kanban"]),field_ids:z.array(z.string().uuid()),widths:z.record(z.number()),filters:z.array(z.object({field_id:z.string().uuid(),operator:z.enum(["eq","ne","contains","empty","not_empty","gt","gte","lt","lte"]),value:cellSchema})),sorts:z.array(z.object({field_id:z.string().uuid(),descending:z.boolean()})),group_field_id:z.string().uuid().nullable()});
export const definitionSchema=z.object({title:z.string(),fields:z.array(fieldSchema),views:z.array(viewSchema),public_view_id:z.string().uuid(),public_field_ids:z.array(z.string().uuid())});
const recordSchema=z.object({id:z.string().uuid(),values:z.record(cellSchema)});
const metadataSchema=z.object({table_id:z.string().uuid(),block_id:z.string().uuid(),table_version:z.number().int().positive(),content_version:z.number().int().positive(),definition:definitionSchema});
const pageSchema=z.object({table:metadataSchema,view_id:z.string().uuid(),items:z.array(recordSchema),groups:z.array(z.object({option_id:z.string().uuid().nullable(),name:z.string(),count:z.number().int().nonnegative()})),pagination:paginationSchema});
const changesSchema=z.object({definition:definitionSchema.nullable().optional(),upserts:z.array(recordSchema).nullable().optional(),deletes:z.array(z.string().uuid()).nullable().optional(),restores:z.array(z.object({id:z.string().uuid(),table_version:z.number().int().positive()})).nullable().optional()});
const resultSchema=z.object({table_id:z.string().uuid(),block_id:z.string().uuid(),table_version:z.number().int().positive(),content_version:z.number().int().positive(),inverse:changesSchema.nullable()});
export type TableResult={content_version:number;table_revision:number;table_id:string;block:OrbisBlock;inverse:TableChanges};
export function tablePath(noteId:string,tableId:string,auth:AuthRequestOptions){return workspacePath(auth,`/documents/${noteId}/tables/${tableId}`);}
function resultView(raw:unknown):TableResult{
  const value=resultSchema.parse(raw);
  return {content_version:value.content_version,table_revision:value.table_version,table_id:value.table_id,block:{id:value.block_id,type:"dataTable",props:{table_id:value.table_id,table_revision:value.table_version},content:[],children:[]},inverse:{...(value.inverse?.definition?{definition:value.inverse.definition}:{}),...(value.inverse?.upserts?{upserts:value.inverse.upserts}:{}),...(value.inverse?.deletes?{deletes:value.inverse.deletes}:{}),...(value.inverse?.restores?{restores:value.inverse.restores}:{} )}};
}
export async function readTable(noteId:string,tableId:string,auth:AuthRequestOptions|null,options:{viewId?:string;offset?:number;revision?:number;documentVersion?:number;group?:string;signal?:AbortSignal}={}):Promise<TablePage>{
  if(!auth)throw new ApiError(401,"请先登录读取私有表格。","AUTH_REQUIRED");
  const offset=options.offset??0;
  if(offset<0||offset%TABLE_PAGE_SIZE!==0)throw new Error("表格页码不正确。");
  const params=new URLSearchParams({page:String(offset/TABLE_PAGE_SIZE+1),page_size:String(TABLE_PAGE_SIZE)});
  if(options.viewId)params.set("view_id",options.viewId);
  if(options.documentVersion)params.set("document_version",String(options.documentVersion));
  if(options.group!==undefined)params.set("group_id",options.group==="__empty__"?"none":options.group);
  const value=pageSchema.parse(await apiRequest(`${tablePath(noteId,tableId,auth)}/records?${params}`,{...authRequestOptions(auth),signal:options.signal}));
  if(value.table.table_id!==tableId || options.revision!==undefined&&value.table.table_version!==options.revision || options.documentVersion!==undefined&&value.table.content_version!==options.documentVersion)throw new ApiError(409,"表格引用已变化，请重新载入。","TABLE_VERSION_CONFLICT");
  return {table_id:value.table.table_id,block_id:value.table.block_id,revision:value.table.table_version,content_version:value.table.content_version,definition:value.table.definition,view_id:value.view_id,records:value.items,groups:value.groups.map(group=>({id:group.option_id,name:group.name,count:group.count})),total:value.pagination.total,offset:(value.pagination.page-1)*value.pagination.page_size,next_offset:value.pagination.page*value.pagination.page_size,has_more:value.pagination.has_next};
}
async function post(path:string,body:unknown,auth:AuthRequestOptions):Promise<TableResult>{
  return withRequestFeedback(auth, async auth => {
  let uncertain=false;
  for(let attempt=0;attempt<2;attempt+=1){
    try{return resultView(await apiRequest(path,{...authRequestOptions(auth),method:"POST",body:body as Record<string,unknown>}));}
    catch(error){
      const rejected=error instanceof ApiError&&error.status>=400&&error.status<500;
      if(rejected&&!uncertain)throw error;
      uncertain=true;
      if(attempt===1||rejected)throw new ApiError(503, "表格保存结果尚未确认，请重试原操作。本机修改仍保留。", "TABLE_WRITE_RESULT_UNKNOWN", "", null, { cause: error });
    }
  }
  throw new Error("Unreachable table write recovery");

  });
}
export function createTable(noteId:string,payload:{operation_id:string;expected_document_version:number;block_id:string;definition?:TableDefinition;source?:{workspace_id:string;document_id:string;table_id:string;document_version?:number|null}},auth:AuthRequestOptions):Promise<TableResult>{
  return post(workspacePath(auth,`/documents/${noteId}/tables`),payload,auth);
}
export function mutateTable(noteId:string,tableId:string,payload:TableMutation,auth:AuthRequestOptions):Promise<TableResult>{
  const {block_id:_block,expected_table_revision,...changes}=payload;
  return post(`${tablePath(noteId,tableId,auth)}/changes`,{...changes,expected_table_version:expected_table_revision},auth);
}
export async function exportTable(noteId:string,tableId:string,format:"csv"|"markdown",viewId:string,documentVersion:number,auth:AuthRequestOptions):Promise<Blob>{
  const params=new URLSearchParams({format,view_id:viewId,document_version:String(documentVersion)});
  return apiBlobRequest(`${tablePath(noteId,tableId,auth)}/export?${params}`,authRequestOptions(auth));
}
