import {afterEach,expect,it,vi} from "vitest";
import {lookupSearchResource,searchWorkspace} from "./api";
import type {AuthRequestOptions} from "../../shared/auth/use-auth-request";
const wid="00000000-0000-4000-8000-000000000001",cid="00000000-0000-4000-8000-000000000002";
const auth:AuthRequestOptions={accessToken:"access",refreshToken:null,workspaceId:wid,onTokenRefresh:vi.fn(),onUnauthorized:vi.fn()};
const item={id:cid,type:"collection",workspace_id:wid,title:"文集",location:"分组",snippet:"普通文本<script>",match:"title",matched_comment_id:null,status:"active",updated_at_ms:1,collection_id:cid,group_id:null};
function response(items:unknown[]){return new Response(JSON.stringify({code:"OK",message:"成功",request_id:"req",data:{items,pagination:{page:1,page_size:20,total:items.length}}}),{headers:{"Content-Type":"application/json"}});}
afterEach(()=>vi.unstubAllGlobals());
it("binds keyword search to an explicit workspace and maps collection presentation names",async()=>{
  const fetchMock=vi.fn().mockResolvedValue(response([item]));vi.stubGlobal("fetch",fetchMock);
  const result=await searchWorkspace({q:"literal%_",type:"notebook",status:"all",page:1},auth);
  expect(result.items[0]).toMatchObject({type:"notebook",notebook_id:cid,snippet:"普通文本<script>"});
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/workspaces/${wid}/search?q=literal%25_&type=collection&status=all&page=1&page_size=20`);
  expect(result.pagination.has_next).toBe(false);
});
it("uses native exact lookup and rejects foreign-workspace response data",async()=>{
  const fetchMock=vi.fn().mockResolvedValueOnce(response([item])).mockResolvedValueOnce(response([{...item,workspace_id:cid}]));vi.stubGlobal("fetch",fetchMock);
  expect((await lookupSearchResource("notebook",cid,"active",auth))?.id).toBe(cid);
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/workspaces/${wid}/search?type=collection&resource_id=${cid}&status=active`);
  await expect(lookupSearchResource("notebook",cid,"active",auth)).rejects.toMatchObject({code:"API_RESPONSE_INVALID"});
});
