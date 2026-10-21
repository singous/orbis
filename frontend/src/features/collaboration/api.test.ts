import {afterEach,expect,it,vi} from "vitest";
import {getRevision,restoreRevision,updateComment} from "./api";
import type {AuthRequestOptions} from "../../shared/auth/use-auth-request";
const wid="00000000-0000-4000-8000-000000000001",did="00000000-0000-4000-8000-000000000002",commentId="00000000-0000-4000-8000-000000000003",operationId="00000000-0000-4000-8000-000000000004";
const auth:AuthRequestOptions={accessToken:"access",refreshToken:null,workspaceId:wid,onTokenRefresh:vi.fn(),onUnauthorized:vi.fn()};
const revision={document_id:did,version:3,title:"",title_recorded:false,author_id:null,author_name:"未知作者",restored_from_version:null,created_at_ms:1};
function response(data:unknown){return new Response(JSON.stringify({code:"OK",message:"成功",request_id:"req",data}),{headers:{"Content-Type":"application/json"}});}
afterEach(()=>vi.unstubAllGlobals());
it("uses the rendered comment version when editing or reopening a discussion",async()=>{
  const comment={id:commentId,workspace_id:wid,document_id:did,parent_id:null,author_id:commentId,author_name:"作者",body:"讨论",is_resolved:false,resolved_at_ms:null,version:5,created_at_ms:1,updated_at_ms:1};
  const fetchMock=vi.fn().mockResolvedValue(response(comment));vi.stubGlobal("fetch",fetchMock);
  expect((await updateComment(did,commentId,{is_resolved:false,expected_version:4},auth)).note_id).toBe(did);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({is_resolved:false,expected_version:4});
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/workspaces/${wid}/documents/${did}/comments/${commentId}`);
});
it("reads immutable content by numeric version and preserves unknown historical authorship/title",async()=>{
  const fetchMock=vi.fn().mockResolvedValue(response({revision,blocks:[]}));vi.stubGlobal("fetch",fetchMock);
  const result=await getRevision(did,"3",auth);
  expect(result).toMatchObject({id:"3",content_version:3,title_recorded:false,author_id:null});
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/workspaces/${wid}/documents/${did}/content?version=3`);
});
it("retries an uncertain restore with its original UUID and returns the actual restored title",async()=>{
  const fetchMock=vi.fn().mockRejectedValueOnce(new TypeError("connection lost")).mockResolvedValueOnce(response({revision:{...revision,version:6,title:"历史标题",title_recorded:true,restored_from_version:3},blocks:[]}));vi.stubGlobal("fetch",fetchMock);
  const restored=await restoreRevision(did,"3",5,operationId,auth);
  expect(restored).toMatchObject({content_version:6,title:"历史标题",kind:"complete"});
  expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({operation_id:operationId,expected_version:5,source_version:3});
});
