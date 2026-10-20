import { afterEach,expect,it,vi } from "vitest";
import { getNoteChildrenPage,getNoteContent,saveNoteBlockChanges,saveNoteContent,type AuthRequestOptions } from "./api";
const wid="00000000-0000-4000-8000-000000000001",cid="00000000-0000-4000-8000-000000000002",did="00000000-0000-4000-8000-000000000003",bid="00000000-0000-4000-8000-000000000004",operation="00000000-0000-4000-8000-000000000005";
const auth:AuthRequestOptions={accessToken:"access",refreshToken:null,workspaceId:wid,onTokenRefresh:vi.fn(),onUnauthorized:vi.fn()};
const metadata={id:did,workspace_id:wid,collection_id:cid,title:"固定版本标题",parent_id:null,position:0,content_version:5,is_archived:false,archived_at_ms:null,created_at_ms:1,updated_at_ms:1};
const payload={type:"paragraph",props:{},content:[{text:"正文",marks:[],href:null}]};
const record={id:bid,parent_id:null,position:32,block_revision:5,child_count:2,block_type:"paragraph",payload_loaded:true,payload_bytes:100,payload};
const result={document_id:did,operation_id:operation,base_version:5,content_version:6,title:"已保存",changed_block_ids:[bid],deleted_block_ids:[]};
const input={noteId:did,expectedVersion:5,operationId:operation,operations:[{type:"update_metadata" as const,title:"已保存"}]};
function response(data:unknown,status=200,code=status<400?"OK":"RESOURCE_NOT_FOUND") {return new Response(JSON.stringify({code,message:"响应",request_id:"request",data}),{status,headers:{"Content-Type":"application/json"}});}
afterEach(()=>vi.unstubAllGlobals());
it("pins an initial child read to the captured metadata version and preserves omitted subtrees",async()=>{
  const fetchMock=vi.fn().mockResolvedValueOnce(response(metadata)).mockResolvedValueOnce(response({version:5,items:[record],pagination:{next_cursor:"opaque+/=",has_more:true}}));
  vi.stubGlobal("fetch",fetchMock);
  const page=await getNoteChildrenPage(did,auth);
  expect(page.title).toBe(metadata.title);
  expect(page.content_version).toBe(5);
  expect(page.next_cursor).toBe("opaque+/=");
  expect(page.descriptors[0]).toMatchObject({id:bid,child_count:2,children_loaded:false,payload_loaded:true});
  expect(page.blocks).toMatchObject({schema_version:2,blocks:[{id:bid,children:[]}]});
  expect(fetchMock.mock.calls[1][0]).toBe(`/api/v1/workspaces/${wid}/documents/${did}/children?page_size=32&version=5`);
});
it("sends an opaque cursor unchanged and caps completion pages to the native maximum",async()=>{
  const cursor="opaque+/=cursor";
  const fetchMock=vi.fn().mockResolvedValue(response({version:5,items:[record],pagination:{next_cursor:null,has_more:false}}));
  vi.stubGlobal("fetch",fetchMock);
  const page=await getNoteChildrenPage(did,auth,{cursor,version:5,limit:256});
  const requested=new URL(fetchMock.mock.calls[0][0],"https://example.test");
  expect(requested.searchParams.get("cursor")).toBe(cursor);
  expect(requested.searchParams.get("page_size")).toBe("100");
  expect(page.read_position).toBe(33);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each([404,405])("does not fall back to an unbounded full read after HTTP%d",async status=>{
  const fetchMock=vi.fn().mockResolvedValue(response(null,status));vi.stubGlobal("fetch",fetchMock);
  await expect(getNoteChildrenPage(did,auth,{version:5})).rejects.toMatchObject({status});
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("rejects a mismatched content snapshot and preserves unknown historical titles as null",async()=>{
  const fetchMock=vi.fn().mockResolvedValueOnce(response({version:6,items:[],pagination:{next_cursor:null,has_more:false}})).mockResolvedValueOnce(response({revision:{document_id:did,version:3,title:"",title_recorded:false},blocks:[]}));
  vi.stubGlobal("fetch",fetchMock);
  await expect(getNoteChildrenPage(did,auth,{version:5})).rejects.toMatchObject({code:"API_RESPONSE_INVALID"});
  expect(await getNoteContent(did,auth,undefined,3)).toMatchObject({kind:"complete",content_version:3,title:null});
});
it("recovers a committed command receipt after response loss without another POST",async()=>{
  const fetchMock=vi.fn().mockRejectedValueOnce(new TypeError("connection lost")).mockResolvedValueOnce(response(result));vi.stubGlobal("fetch",fetchMock);
  expect((await saveNoteBlockChanges(input,auth)).content_version).toBe(6);
  expect(fetchMock.mock.calls.map(call=>call[1].method)).toEqual(["POST","GET"]);
  expect(fetchMock.mock.calls[1][0]).toBe(`/api/v1/workspaces/${wid}/documents/${did}/operations/${operation}`);
});
it("retries the exact original command only after an absent receipt",async()=>{
  const fetchMock=vi.fn().mockRejectedValueOnce(new TypeError("connection lost")).mockResolvedValueOnce(response(null,404,"OPERATION_NOT_FOUND")).mockResolvedValueOnce(response(result));vi.stubGlobal("fetch",fetchMock);
  await saveNoteBlockChanges(input,auth);
  expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[2][1].body);
});
it("keeps an archived or inaccessible receipt result unknown instead of resubmitting",async()=>{
  const fetchMock=vi.fn().mockRejectedValueOnce(new TypeError("connection lost")).mockResolvedValueOnce(response(null,404));vi.stubGlobal("fetch",fetchMock);
  await expect(saveNoteBlockChanges(input,auth)).rejects.toMatchObject({code:"DOCUMENT_WRITE_RESULT_UNKNOWN",data:{operation_id:operation}});
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("retries complete snapshots with the same UUID and native block shape",async()=>{
  const fetchMock=vi.fn().mockRejectedValueOnce(new TypeError("connection lost")).mockResolvedValueOnce(response({revision:{document_id:did,version:6,title:"已保存",title_recorded:true},blocks:[{...payload,id:bid,children:[]}]}));vi.stubGlobal("fetch",fetchMock);
  const saved=await saveNoteContent({noteId:did,expectedVersion:5,operationId:operation,title:"已保存",blocks:{schema_version:2,editor:"blocknote",blocks:[{id:bid,type:"paragraph",props:{},content:[{type:"text",text:"正文"}],children:[]}]}},auth);
  expect(saved.content_version).toBe(6);
  expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({operation_id:operation,expected_version:5,title:"已保存",blocks:[{...payload,id:bid,children:[]}]});
});
