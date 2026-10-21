import {nativePayloadSchema} from "../content/codecs/api-content";
import type {TableCopyIntent} from "./editor/table-copy";
import {z} from "zod";
import {ApiError,apiRequest,workspacePath} from "../../shared/api/api-client";
import {authRequestOptions,type AuthRequestOptions} from "../../shared/auth/use-auth-request";
import type {DocumentCommand} from "./document-commands";
export const documentWriteResultSchema=z.object({ document_id:z.string().uuid(),operation_id:z.string().uuid(),base_version:z.number().int().positive(),content_version:z.number().int().positive(),title:z.string(),changed_block_ids:z.array(z.string().uuid()),deleted_block_ids:z.array(z.string().uuid()),resolved_blocks:z.array(z.object({id:z.string().uuid(),payload:nativePayloadSchema})).optional() });
const resultSchema=documentWriteResultSchema;
const documentPath=(id:string,auth:AuthRequestOptions,suffix="")=>workspacePath(auth,`/documents/${id}${suffix}`);
function uncertain(error:unknown){return !(error instanceof ApiError)||error.status>=500||error.status===0;}
export async function saveNoteBlockChanges(payload:{noteId:string;expectedVersion:number;operationId:string;operations:DocumentCommand[];tableCopies?:TableCopyIntent[]},auth:AuthRequestOptions) {
  const body={ operation_id:payload.operationId,expected_version:payload.expectedVersion,operations:payload.operations,...(payload.tableCopies?.length?{table_copies:payload.tableCopies}:{}) };
  let wasUncertain=false;
  for(let attempt=0;attempt<2;attempt+=1) {
    try {
      const result=resultSchema.parse(await apiRequest(documentPath(payload.noteId,auth,"/operations"),{...authRequestOptions(auth),method:"POST",body}));
      return {...result,note_id:result.document_id,table_blocks:[]};
    } catch(error) {
      if(!uncertain(error)) {
        if(wasUncertain) throw new ApiError(503,"上次保存结果尚未确认，请重试原来的保存。草稿仍保留。","DOCUMENT_WRITE_RESULT_UNKNOWN","",{operation_id:payload.operationId});
        throw error;
      }
      wasUncertain=true;
      try {
        const result=resultSchema.parse(await apiRequest(documentPath(payload.noteId,auth,`/operations/${payload.operationId}`),authRequestOptions(auth)));
        return {...result,note_id:result.document_id,table_blocks:[]};
      } catch(receiptError) {
        if(!(receiptError instanceof ApiError) || receiptError.code!=="OPERATION_NOT_FOUND" || attempt===1) throw new ApiError(503,"上次保存结果尚未确认，请重试原来的保存。草稿仍保留。","DOCUMENT_WRITE_RESULT_UNKNOWN","",{operation_id:payload.operationId});
      }
    }
  }
  throw new Error("Unreachable document write recovery");
}
