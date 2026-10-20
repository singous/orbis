import {validTableCopies,resolveTableCopies,type TableCopyIntent,type ResolvedCopyBlock} from "./table-copy";
import { ApiError } from "../../../shared/api/api-client";
import { newUUID } from "../../../shared/ids";
import type { EditorDraft } from "./editor-draft";
import type { BlockChanges } from "./block-changes";
import { planDocumentWrite,type DocumentCommand } from "../document-commands";

export type PendingDocumentWrite={
  format_version:1;
  document_id:string;
  operation_id:string;
  expected_version:number;
  kind:"commands"|"full";
  operations:DocumentCommand[];
  table_copies?:TableCopyIntent[];
  submitted:EditorDraft;
  uncertain:boolean;
};
export function isPendingDocumentWrite(value:unknown,documentId:string):value is PendingDocumentWrite {
  if(!value||typeof value!=="object")return false;
  const pending=value as Partial<PendingDocumentWrite>;
  return pending.format_version===1&&pending.document_id===documentId&&typeof pending.operation_id==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(pending.operation_id)&&Number.isSafeInteger(pending.expected_version)&&(pending.expected_version??0)>0&&(pending.kind==="commands"||pending.kind==="full")&&Array.isArray(pending.operations)&&typeof pending.uncertain==="boolean"&&!!pending.submitted&&typeof pending.submitted.title==="string"&&pending.submitted.version===pending.expected_version&&pending.submitted.blocks?.schema_version===2&&Array.isArray(pending.submitted.blocks.blocks)&&(pending.table_copies===undefined||validTableCopies(pending.table_copies));
}
type Result={content_version:number;title:string|null;deleted_block_ids?:string[];resolved_blocks?:ResolvedCopyBlock[]};
type Options={
  documentId:string;
  checkpoint:(pending:PendingDocumentWrite|null,flush:boolean)=>Promise<void>;
  write:(pending:PendingDocumentWrite)=>Promise<Result>;
  onDeleted?:(ids:string[])=>void;
  onResolved?:(copies:TableCopyIntent[],resolved:ResolvedCopyBlock[],version:number)=>void;
};
/** One editor owns its original pending intent until a receipt or definitive rejection resolves it. */
export class DocumentWriter {
  #pending:PendingDocumentWrite|null=null;
  constructor(private readonly options:Options) {}
  get pending(){return this.#pending;}
  discard(){this.#pending=null;}
  restore(pending:PendingDocumentWrite|null|undefined){
    if(!pending)return;
    if(!isPendingDocumentWrite(pending,this.options.documentId)) throw new Error("待确认的本机保存记录无法读取，草稿仍保留。");
    this.#pending={...pending,uncertain:true};
  }
  async #checkpoint(flush:boolean){
    // Existing online editing remains available when the browser refuses local persistence.
    // The checkpoint controller reports that failure separately; the in-memory intent is retained.
    try {await this.options.checkpoint(this.#pending,flush);} catch { /* The owner displays local backup failures. */ }
  }
  async save(current:EditorDraft,saved:EditorDraft,complete:boolean,changes?:BlockChanges):Promise<EditorDraft>{
    if(!this.#pending){
      const plan=planDocumentWrite(saved,current,complete,changes);
      if(plan.kind==="commands" && !plan.operations.length)return {...current,version:saved.version,title:current.title.trim()||"未命名文档"};
      if(plan.kind==="full"&&current.tableCopies?.length)throw new Error("请先提交其他正文修改，再单独复制表格。当前草稿仍保留。");
      this.#pending={format_version:1,document_id:this.options.documentId,operation_id:newUUID(),expected_version:saved.version,kind:plan.kind,operations:plan.kind==="commands"?plan.operations:[],table_copies:current.tableCopies?.length?structuredClone(current.tableCopies):undefined,submitted:{...current,version:saved.version},uncertain:false};
    }
    const pending=this.#pending;
    await this.#checkpoint(true);
    let result:Result;
    try {
      result=await this.options.write(pending);
      if(pending.table_copies?.length){
        const resolved=result.resolved_blocks??[],ids=new Set(resolved.map(block=>block.id));
        if(resolved.length!==pending.table_copies.length||ids.size!==resolved.length||pending.table_copies.some(copy=>!ids.has(copy.block_id))||resolved.some(block=>block.payload.type!=="data_table"||typeof block.payload.props.table_id!=="string"||block.payload.props.table_version!==1))throw new ApiError(502,"表格复制回执不完整，请重试原操作。","API_RESPONSE_INVALID");
      }
    }
    catch(error){
      if(!pending.uncertain && error instanceof ApiError && error.status>=400 && error.status<500){
        this.#pending=null;
      }else{
        pending.uncertain=true;
      }
      await this.#checkpoint(true);
      if(this.#pending?.uncertain && error instanceof ApiError && error.status>=400 && error.status<500) throw new ApiError(503,"上次保存结果尚未确认，当前访问权限暂时无法完成确认。草稿仍保留。","DOCUMENT_WRITE_RESULT_UNKNOWN","",{operation_id:pending.operation_id});
      throw error;
    }
    this.#pending=null;
    if(pending.table_copies?.length)this.options.onResolved?.(pending.table_copies,result.resolved_blocks!,result.content_version);
    this.options.onDeleted?.(result.deleted_block_ids??[]);
    // The deferred source observes the coordinator's updated saved baseline after this promise resolves.
    await this.#checkpoint(false);
    const submitted=pending.table_copies?.length?resolveTableCopies(pending.submitted,pending.table_copies,result.resolved_blocks!,result.content_version):pending.submitted;
    return {...submitted,version:result.content_version,title:result.title??(pending.submitted.title.trim()||"未命名文档")};
  }
}
