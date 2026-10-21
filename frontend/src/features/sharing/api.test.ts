import {afterEach,expect,it,vi} from "vitest";
import {createShare,readPublicShare,readSharedContent,revokeShare} from "./api";
import type {AuthRequestOptions} from "../../shared/auth/use-auth-request";
const id=(n:string)=>"00000000-0000-4000-8000-"+n.padStart(12,"0");
const wid=id("1"),cid=id("2"),did=id("3"),sid=id("4"),bid=id("5"),token="a".repeat(43);
const auth:AuthRequestOptions={accessToken:"access",refreshToken:null,workspaceId:wid,onTokenRefresh:vi.fn(),onUnauthorized:vi.fn()};
function response(data:unknown){return new Response(JSON.stringify({code:"OK",message:"成功",request_id:"req",data}),{headers:{"Content-Type":"application/json"}});}
const share={id:sid,collection_id:cid,root_document_id:did,version:1,expires_at_ms:null,revoked_at_ms:null,created_at_ms:1,path:`/share/${token}`};
afterEach(()=>vi.unstubAllGlobals());
it("creates an explicitly acknowledged native subtree share and revokes its observed version",async()=>{
  const fetchMock=vi.fn().mockResolvedValueOnce(response({share,token,path:share.path})).mockResolvedValueOnce(response({...share,version:2,revoked_at_ms:2,path:null}));vi.stubGlobal("fetch",fetchMock);
  const created=await createShare({notebookId:cid,noteId:did,title:"文档"},auth);
  expect(created).toMatchObject({id:sid,version:1,path:share.path});
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({collection_id:cid,root_document_id:did,acknowledge_public_scope:true});
  await revokeShare(sid,1,auth);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({expected_version:1});
});
it("paginates only the requested directory parent at a fixed structural version",async()=>{
  const data={title:"分享",root_document_id:did,directory_version:7,items:[],pagination:{page:2,page_size:20,total:21}};
  const fetchMock=vi.fn().mockResolvedValue(response(data));vi.stubGlobal("fetch",fetchMock);
  const result=await readPublicShare(token,undefined,{parentId:did,page:2,directoryVersion:7});
  expect(result.root_note_id).toBe(did);
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/public/shares/${token}/directory?page=2&page_size=20&parent_id=${did}&directory_version=7`);
  expect(new Headers(fetchMock.mock.calls[0][1].headers).has("Authorization")).toBe(false);
});
it("keeps deferred payloads and child descriptors distinct from empty authored blocks",async()=>{
  const fetchMock=vi.fn().mockResolvedValue(response({document:{id:did,title:"文档",content_version:2,updated_at_ms:1},items:[{id:bid,parent_id:null,position:0,block_type:"group",child_count:3,payload_bytes:200000,payload_loaded:false,block:null}],pagination:{next_cursor:"opaque-next",has_more:true}}));vi.stubGlobal("fetch",fetchMock);
  const page=await readSharedContent(token,did,{version:2,cursor:"opaque-before"});
  expect(page.descriptors[0]).toMatchObject({payload_loaded:false,child_count:3,children_loaded:false});
  expect(page.next_cursor).toBe("opaque-next");
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/public/shares/${token}/documents/${did}/children?page_size=32&cursor=opaque-before&version=2`);
});
