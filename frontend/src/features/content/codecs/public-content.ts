import {z} from "zod";
import {editorPayload,nativePayloadSchema,type NativePayload} from "./api-content";
import {publicTableRefSchema,publicTableSnapshot} from "../../data-tables/public-contract";
import type {OrbisBlock} from "../blocks";
import {boardViewSchema,type BoardViewData} from "../../boards/public-contract";
type PublicBlock=NativePayload&{id:string;children:PublicBlock[];data_table?:z.infer<typeof publicTableRefSchema>;board?:BoardViewData};
export const publicBlockSchema:z.ZodType<PublicBlock>=nativePayloadSchema.extend({id:z.string().min(1),data_table:publicTableRefSchema.optional(),board:boardViewSchema.optional(),children:z.lazy(()=>z.array(publicBlockSchema))});
function previewLink(value:string,workspaceId?:string):string{
  const match=/^\/api\/v1\/workspaces\/([0-9a-f-]{36})\/assets\/([0-9a-f-]{36})\/content$/.exec(value);
  return match&&match[1]===workspaceId?`orbis-file:${match[2]}`:value;
}
export function publicEditorBlock(block:PublicBlock,workspaceId?:string):OrbisBlock&{table_snapshot?:ReturnType<typeof publicTableSnapshot>;board_snapshot?:BoardViewData}{
  const props={...block.props};
  if(typeof props.href==="string")props.href=previewLink(props.href,workspaceId);
  const source=props.source as {type?:string;url?:string}|null|undefined;
  if(source?.type==="external"&&typeof source.url==="string"){
    const link=previewLink(source.url,workspaceId);
    if(link.startsWith("orbis-file:"))props.source={type:"asset",asset_id:link.slice(11)};
  }
  const payload={...block,props,content:block.content.map(run=>({...run,href:run.href===null?null:previewLink(run.href,workspaceId)}))};
  const editor=editorPayload(block.id,payload);
  return {...editor,children:block.children.map(child=>publicEditorBlock(child,workspaceId)),...(block.data_table?{table_snapshot:publicTableSnapshot(block.data_table)}:{}),...(block.board?{board_snapshot:block.board}:{})};
}
export function publicEditorBlocks(raw:unknown,workspaceId?:string){return {schema_version:2 as const,editor:"blocknote" as const,blocks:z.array(publicBlockSchema).parse(raw).map(block=>publicEditorBlock(block,workspaceId))};}
export function privatePreviewLink(value:string|null,workspaceId:string|undefined){return value===null?null:previewLink(value,workspaceId);}
