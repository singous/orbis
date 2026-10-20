import {NOTE_ID,NOTEBOOK_ID,USER_ID,WORKSPACE_ID,content,http,page,response} from "../../collaboration/collaboration.test-utils";
const BLOCK_ID="018ff7c4-a5b6-7000-8000-000000000009";
export const nativeCollection={id:NOTEBOOK_ID,workspace_id:WORKSPACE_ID,group_id:USER_ID,title:"笔记本",sort_order:0,icon:null,metadata_version:1,directory_version:7,is_archived:false,archived_at_ms:null,created_at_ms:1,updated_at_ms:1};
export const nativeDocument={id:NOTE_ID,workspace_id:WORKSPACE_ID,collection_id:NOTEBOOK_ID,parent_id:null,position:0,title:"产品计划",content_version:4,is_archived:false,archived_at_ms:null,created_at_ms:1,updated_at_ms:1};
export const nativeRevision=(version=4,title="产品计划")=>({document_id:NOTE_ID,version,title,title_recorded:true,restored_from_version:null,author_id:USER_ID,author_name:"作者",created_at_ms:1});
export function nativeSnapshot(version=4,text="当前正文",title="产品计划"){
  return {revision:nativeRevision(version,title),blocks:[{id:BLOCK_ID,type:"paragraph",props:{},content:[{text,marks:[],href:null}],children:[]}]};
}
export function nativeEditorServer(options:{saveStatus?:number;archiveStatus?:number;saveGate?:Promise<void>;archiveGate?:Promise<void>}={}){
  const stored={note:{...nativeDocument,archived_at_ms:null as number|null},content:content()};
  const receipts=new Map<string,unknown>();
  const requests=http(async(url,init)=>{
    const input=init.body?JSON.parse(String(init.body)):null;
    if(url.pathname.endsWith("/operations")&&init.method==="POST"){
      await options.saveGate;
      if(options.saveStatus)return response(null,options.saveStatus,"保存失败");
      if(input.expected_version!==stored.content.content_version)return response(null,409,"版本冲突");
      for(const operation of input.operations){
        if(operation.type==="update_metadata")stored.note.title=operation.title;
        else if(operation.type==="update_block"){
          stored.content.blocks.blocks[0]={...stored.content.blocks.blocks[0],...operation.block,content:operation.block.content.map((run:{text:string})=>({type:"text",text:run.text}))};
        }else throw new Error(`Unexpected editor command: ${operation.type}`);
      }
      stored.content.plain_text=String((stored.content.blocks.blocks[0].content as {text:string}[])[0]?.text??"");
      stored.content.content_version+=1;stored.note.content_version=stored.content.content_version;
      const result={document_id:NOTE_ID,operation_id:input.operation_id,base_version:input.expected_version,content_version:stored.content.content_version,title:stored.note.title,changed_block_ids:[BLOCK_ID],deleted_block_ids:[]};
      receipts.set(input.operation_id,result);return response(result);
    }
    if(url.pathname.includes("/operations/")){
      const receipt=receipts.get(url.pathname.split("/").at(-1)!);
      return receipt?response(receipt):new Response(JSON.stringify({code:"OPERATION_NOT_FOUND",message:"回执不存在",request_id:"test",data:null}),{status:404,headers:{"Content-Type":"application/json"}});
    }
    if(url.pathname.endsWith("/archive")&&init.method==="PUT"){
      await options.archiveGate;
      if(options.archiveStatus)return response(null,options.archiveStatus,"归档请求失败");
      if(input.expected_directory_version!==nativeCollection.directory_version)throw new Error("Wrong observed directory version");
      stored.note.is_archived=true;stored.note.archived_at_ms=2;
      return response({document:stored.note,directory_version:8});
    }
    if(url.pathname.endsWith(`/collections/${NOTEBOOK_ID}`))return response(nativeCollection);
    if(url.pathname.endsWith("/children")){
      const snapshot=nativeSnapshot(stored.content.content_version,stored.content.plain_text,stored.note.title);
      return response({version:snapshot.revision.version,items:snapshot.blocks.map((block,position)=>({id:block.id,parent_id:null,position,block_type:block.type,payload_loaded:true,payload_bytes:100,payload:{type:block.type,props:block.props,content:block.content},child_count:0,block_revision:snapshot.revision.version})),pagination:{next_cursor:null,has_more:false}});
    }
    if(url.pathname.endsWith("/content"))return response(nativeSnapshot(stored.content.content_version,stored.content.plain_text,stored.note.title));
    if(url.pathname.endsWith(`/documents/${NOTE_ID}`))return response(stored.note);
    if(init.method&&init.method!=="GET")throw new Error(`Unexpected editor mutation: ${url.pathname}`);
    return response(page([]));
  });
  return {stored,requests};
}
