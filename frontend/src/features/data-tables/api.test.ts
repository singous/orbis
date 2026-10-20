import {afterEach,expect,it,vi} from "vitest";
import {mutateTable,readTable} from "./api";
import {afterAcknowledgement,combineChanges,hasChanges} from "./drafts";
import type {AuthRequestOptions} from "../../shared/auth/use-auth-request";
const id=(n:string)=>"00000000-0000-4000-8000-"+n.padStart(12,"0");
const wid=id("1"),did=id("2"),tid=id("3"),bid=id("4"),viewId=id("5"),recordId=id("6"),fieldId=id("7"),operationId=id("8");
const auth:AuthRequestOptions={accessToken:"access",refreshToken:null,workspaceId:wid,onTokenRefresh:vi.fn(),onUnauthorized:vi.fn()};
const definition={title:"表格",fields:[{id:fieldId,name:"文本",kind:"text",options:[]}],views:[{id:viewId,name:"默认",kind:"grid",field_ids:[fieldId],widths:{},filters:[],sorts:[],group_field_id:null}],public_view_id:viewId,public_field_ids:[fieldId]};
function response(data:unknown){return new Response(JSON.stringify({code:"OK",message:"成功",request_id:"req",data}),{headers:{"Content-Type":"application/json"}});}
const result={table_id:tid,block_id:bid,table_version:4,content_version:11,inverse:{restores:[{id:recordId,table_version:3}],definition:null,upserts:null,deletes:null}};
afterEach(()=>vi.unstubAllGlobals());
it("reads native numbered pages pinned to the document snapshot and preserves falsy cell values",async()=>{
  const fetchMock=vi.fn().mockResolvedValue(response({table:{table_id:tid,block_id:bid,table_version:3,content_version:10,definition},view_id:viewId,items:[{id:recordId,values:{[fieldId]:0,[id("9")]:false,[id("10")]:null}}],groups:[{option_id:null,name:"未分组",count:101}],pagination:{page:2,page_size:100,total:101}}));vi.stubGlobal("fetch",fetchMock);
  const page=await readTable(did,tid,auth,{offset:100,documentVersion:10,revision:3,group:"__empty__"});
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/workspaces/${wid}/documents/${did}/tables/${tid}/records?page=2&page_size=100&document_version=10&group_id=none`);
  expect(page.records[0].values).toEqual({[fieldId]:0,[id("9")]:false,[id("10")]:null});
  expect(page.records[0].values).not.toHaveProperty(id("11"));
  expect(page).toMatchObject({offset:100,has_more:false,revision:3,content_version:10});
});
it("sends original native mutation versions and historical inverse references after response loss",async()=>{
  const fetchMock=vi.fn().mockRejectedValueOnce(new TypeError("lost")).mockResolvedValueOnce(response(result));vi.stubGlobal("fetch",fetchMock);
  const saved=await mutateTable(did,tid,{operation_id:operationId,block_id:bid,expected_document_version:10,expected_table_revision:3,upserts:[{id:recordId,values:{[fieldId]:false}}]},auth);
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/workspaces/${wid}/documents/${did}/tables/${tid}/changes`);
  expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({operation_id:operationId,expected_document_version:10,expected_table_version:3,upserts:[{id:recordId,values:{[fieldId]:false}}]});
  expect(saved.inverse).toEqual({restores:[{id:recordId,table_version:3}]});
  expect(saved.block.props).toEqual({table_id:tid,table_revision:4});
});
it("keeps later edits while acknowledging a historical row restore",()=>{
  const restore={restores:[{id:recordId,table_version:3}]};
  expect(hasChanges(restore)).toBe(true);
  const later=combineChanges(restore,{upserts:[{id:recordId,values:{[fieldId]:0,[id("9")]:false}}]});
  expect(later.restores).toEqual(restore.restores);
  const remaining=afterAcknowledgement(later,restore);
  expect(remaining.restores).toBeUndefined();
  expect(remaining.upserts).toEqual([{id:recordId,values:{[fieldId]:0,[id("9")]:false}}]);
});
