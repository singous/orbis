import { afterEach, expect, it, vi } from "vitest";
import { browseNotes, getNoteTree, setDocumentGroupArchived, setNoteArchived, updateDocumentGroup, updateNotebook } from "./catalog-api";
import type { AuthRequestOptions } from "../../shared/auth/use-auth-request";
const wid="00000000-0000-4000-8000-000000000001", cid="00000000-0000-4000-8000-000000000002", gid="00000000-0000-4000-8000-000000000003", did="00000000-0000-4000-8000-000000000004";
const auth: AuthRequestOptions={ accessToken:"access",refreshToken:null,workspaceId:wid,onTokenRefresh:vi.fn(),onUnauthorized:vi.fn() };
const common={ workspace_id:wid,is_archived:false,archived_at_ms:null,created_at_ms:1,updated_at_ms:1 };
const group={ ...common,id:gid,name:"分组",is_default:false,sort_order:0,version:3 };
const collection={ ...common,id:cid,group_id:gid,title:"文集",sort_order:0,icon:null,metadata_version:4,directory_version:7 };
const document={ ...common,id:did,collection_id:cid,parent_id:null,title:"文档",position:0,content_version:3 };
function response(data:unknown) { return new Response(JSON.stringify({ code:"OK",message:"成功",request_id:"req",data }),{ headers:{ "Content-Type":"application/json" } }); }
function page(items:unknown[]) { return { items,pagination:{ page:1,page_size:100,total:items.length } }; }
afterEach(()=>vi.unstubAllGlobals());
it("sends the user's observed versions without fetching a newer base",async()=>{
  const fetchMock=vi.fn().mockResolvedValueOnce(response({ ...group,version:4 })).mockResolvedValueOnce(response({ ...collection,metadata_version:5 })).mockResolvedValueOnce(response({ ...group,is_archived:true,version:5 }));
  vi.stubGlobal("fetch",fetchMock);
  await updateDocumentGroup(gid,{ name:"修改后的分组",expected_version:3 },auth);
  await updateNotebook(cid,{ title:"修改后的文集",expected_version:4 },auth);
  await setDocumentGroupArchived(gid,true,4,auth);
  expect(fetchMock.mock.calls.map(call=>call[1].method)).toEqual(["PATCH","PATCH","PUT"]);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name:"修改后的分组",expected_version:3 });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ title:"修改后的文集",expected_version:4 });
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/workspaces/${wid}/collection-groups/${gid}`);
});
it("retains the committed directory version for a conditional archive undo",async()=>{
  const fetchMock=vi.fn().mockResolvedValue(response({ document:{ ...document,is_archived:true },directory_version:8 }));
  vi.stubGlobal("fetch",fetchMock);
  const result=await setNoteArchived(did,true,7,auth);
  expect(result.directory_version).toBe(8);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ archived:true,expected_directory_version:7 });
});
it("rejects a directory assembled across two structural versions",async()=>{
  const fetchMock=vi.fn().mockResolvedValueOnce(response(collection)).mockResolvedValueOnce(response(page([document]))).mockResolvedValueOnce(response({ ...collection,directory_version:8 }));
  vi.stubGlobal("fetch",fetchMock);
  await expect(getNoteTree(cid,auth)).rejects.toMatchObject({ code:"DIRECTORY_VERSION_CONFLICT" });
});
it("uses native workspace previews and preserves Unicode summaries without pretending to load full bodies",async()=>{
  const summary="🪐".repeat(240);
  const fetchMock=vi.fn().mockResolvedValueOnce(response(page([{ ...document,summary }]))).mockResolvedValueOnce(response(page([{ ...document,is_archived:true }])));
  vi.stubGlobal("fetch",fetchMock);
  expect((await browseNotes(auth)).items[0].summary).toBe(summary);
  expect((await browseNotes(auth,"archived")).items[0].summary).toBeNull();
  expect(fetchMock.mock.calls.map(call=>call[0])).toEqual([`/api/v1/workspaces/${wid}/documents?page=1&page_size=20`,`/api/v1/workspaces/${wid}/documents/archive?page=1&page_size=20`]);
});
