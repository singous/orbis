import { withRequestFeedback } from "../../shared/api/request-feedback";
import { z } from "zod";
import { ApiError,apiRequest,workspacePath } from "../../shared/api/api-client";
import { authRequestOptions,type AuthRequestOptions } from "../../shared/auth/use-auth-request";
import { editorBlock,nativeBlockSchema } from "../content/codecs/api-content";
import { commentPageSchema,commentSchema,revisionPageSchema,revisionSchema,revisionWireSchema } from "./schemas";
const PAGE_SIZE=20;
export type CreateComment={body:string;parent_id?:string};
export type UpdateComment={body?:string;is_resolved?:boolean;expected_version:number};
const notePath=(id:string,auth:AuthRequestOptions)=>workspacePath(auth,`/documents/${encodeURIComponent(id)}`);
export async function listComments(id:string,page:number,auth:AuthRequestOptions,signal?:AbortSignal){
  return commentPageSchema.parse(await apiRequest(`${notePath(id,auth)}/comments?page=${page}&page_size=${PAGE_SIZE}`,{...authRequestOptions(auth),signal}));
}
export async function createComment(id:string,payload:CreateComment,auth:AuthRequestOptions){
  return commentSchema.parse(await apiRequest(`${notePath(id,auth)}/comments`,{...authRequestOptions(auth),method:"POST",body:payload}));
}
export async function updateComment(id:string,commentId:string,payload:UpdateComment,auth:AuthRequestOptions){
  return commentSchema.parse(await apiRequest(`${notePath(id,auth)}/comments/${encodeURIComponent(commentId)}`,{...authRequestOptions(auth),method:"PATCH",body:payload}));
}
export async function listRevisions(id:string,page:number,auth:AuthRequestOptions,signal?:AbortSignal){
  return revisionPageSchema.parse(await apiRequest(`${notePath(id,auth)}/revisions?page=${page}&page_size=${PAGE_SIZE}`,{...authRequestOptions(auth),signal}));
}
export async function getRevision(id:string,revisionId:string,auth:AuthRequestOptions,signal?:AbortSignal){
  const version=Number(revisionId);
  if(!Number.isSafeInteger(version)||version<1)throw new Error("历史版本号无效。");
  const raw=z.object({revision:revisionWireSchema,blocks:z.array(nativeBlockSchema)}).parse(await apiRequest(`${notePath(id,auth)}/content?version=${version}`,{...authRequestOptions(auth),signal}));
  if(raw.revision.document_id!==id||raw.revision.version!==version)throw new ApiError(502,"历史版本响应不一致。","API_RESPONSE_INVALID");
  return revisionSchema.parse({...raw.revision,blocks:{schema_version:2,editor:"blocknote",blocks:raw.blocks.map(editorBlock)}});
}
export async function restoreRevision(id:string,revisionId:string,expectedVersion:number,operationId:string,auth:AuthRequestOptions){
  return withRequestFeedback({ ...auth, feedback: { ...auth.feedback, success: true } }, async auth => {
  const body={operation_id:operationId,expected_version:expectedVersion,source_version:Number(revisionId)};
  let uncertain=false;
  for(let attempt=0;attempt<2;attempt+=1){
    try{
      const raw=z.object({revision:revisionWireSchema}).passthrough().parse(await apiRequest(`${notePath(id,auth)}/restore`,{...authRequestOptions(auth),method:"POST",body}));
      // The successful response already contains the exact restored body; parse it through the shared reader projection.
      const content=z.object({blocks:z.array(nativeBlockSchema)}).parse(raw);
      return {kind:"complete" as const,note_id:id,content_version:raw.revision.version,title:raw.revision.title_recorded?raw.revision.title:null,blocks:{schema_version:2 as const,editor:"blocknote" as const,blocks:content.blocks.map(editorBlock)}};
    }catch(error){
      const definitive=error instanceof ApiError&&error.status>=400&&error.status<500;
      if(definitive&&!uncertain)throw error;
      uncertain=true;
      if(attempt===1||definitive)throw new ApiError(503, "恢复结果尚未确认，请重试原来的恢复操作。当前草稿仍保留。", "DOCUMENT_WRITE_RESULT_UNKNOWN", "", {operation_id:operationId}, { cause: error });
    }
  }
  throw new Error("Unreachable revision restore recovery");

  });
}
