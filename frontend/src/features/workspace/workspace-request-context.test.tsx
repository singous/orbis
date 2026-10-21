import {act,cleanup,renderHook,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {apiBlobRequest,apiRequest,workspacePath} from "../../shared/api/api-client";
import {authStore,getAuthSessionKey} from "../../shared/auth/auth-store";
import {authRequestOptions,useAuthRequest} from "../../shared/auth/use-auth-request";
import {getProfile} from "../../shared/auth/profile-api";
import {getNote} from "../documents/api";
import {listMembers} from "../members/api";
import {listWorkspaces,switchWorkspace} from "./api";
const A="018ff7c4-a5b6-7000-8000-000000000001",B="018ff7c4-a5b6-7000-8000-000000000002",USER="018ff7c4-a5b6-7000-8000-000000000003";
const user={id:USER,email:"owner@orbis.test",display_name:"Owner",bio:null,avatar_asset_id:null,profile_version:1,preferred_workspace_id:A,created_at_ms:1,updated_at_ms:1};
const workspace={id:A,name:"工作空间 A",role:"owner" as const,created_at_ms:1,updated_at_ms:1};
const session={accessToken:"context-access",refreshToken:"context-refresh",user,workspace};
const response=(data:unknown,status=200)=>new Response(JSON.stringify({code:status===200?"OK":"AUTH_REQUIRED",message:"请求结果",request_id:"context",data}),{status,headers:{"Content-Type":"application/json"}});
beforeEach(()=>act(()=>authStore.getState().setSession(session)));
afterEach(()=>{cleanup();authStore.getState().clearSession();vi.unstubAllGlobals();});
describe("explicit request workspace",()=>{
  it("captures scope independently of a later account and ignores its stale credential callbacks",()=>{
    const {result}=renderHook(useAuthRequest),original=result.current;
    act(()=>authStore.getState().setSession({...session,workspace:{...workspace,id:B},accessToken:"different-login"}));
    expect(workspacePath(original,"/documents")).toBe(`/v1/workspaces/${A}/documents`);
    expect(result.current.workspaceId).toBe(B);
    act(()=>{original.onTokenRefresh("late-access","late-refresh");original.onUnauthorized();});
    expect(authStore.getState().accessToken).toBe("different-login");
  });
  it("requires an explicit selected workspace instead of guessing from the account preference",()=>{
    act(()=>authStore.setState({workspace:null}));const {result}=renderHook(useAuthRequest);
    expect(result.current.workspaceId).toBeNull();
    expect(()=>workspacePath(result.current,"/documents")).toThrow("请先选择工作空间");
  });
  it.each(["json","blob","upload"])("uses the path scope and sends no workspace header for %s",async kind=>{
    const fetch=vi.fn(async(url:string,init:RequestInit)=>{
      expect(url).toContain(`/api/v1/workspaces/${A}/assets`);
      const headers=new Headers(init.headers);expect(headers.has("X-Workspace-ID")).toBe(false);expect(headers.get("Authorization")).toBe("Bearer context-access");
      if(kind==="upload")expect(headers.has("Content-Type")).toBe(false);
      return kind==="blob"?new Response("bytes"):response({ok:true});
    });vi.stubGlobal("fetch",fetch);
    const {result}=renderHook(useAuthRequest),path=workspacePath(result.current,"/assets"),options=authRequestOptions(result.current);
    if(kind==="blob")await apiBlobRequest(`${path}/asset/content`,options);
    else if(kind==="upload"){const body=new FormData();body.append("file",new Blob(["upload"]),"asset.txt");await apiRequest(path,{...options,method:"POST",body});}
    else await apiRequest(path,{...options,method:"POST",body:{title:"文档"}});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps a rotating request on its original path when the tab selects another workspace",async()=>{
    let finish!:(value:Response)=>void;const calls:Array<{url:string;headers:Headers}>=[];
    vi.stubGlobal("fetch",vi.fn((url:string,init:RequestInit)=>{
      calls.push({url,headers:new Headers(init.headers)});
      return url.endsWith("/auth/refresh")?new Promise<Response>(resolve=>{finish=resolve;}):Promise.resolve(calls.length===1?response(null,401):response({ok:true}));
    }));
    const {result}=renderHook(useAuthRequest),options=authRequestOptions(result.current),path=workspacePath(result.current,"/documents/current");
    const pending=apiRequest(path,options);await waitFor(()=>expect(finish).toBeDefined());
    options.workspaceId=B;act(()=>authStore.getState().setSession({...session,workspace:{...workspace,id:B}}));
    await act(async()=>{finish(response({access_token:"context-rotated",refresh_token:"context-rotated-refresh"}));await pending;});
    expect(calls.map(call=>call.url)).toEqual([`/api/v1/workspaces/${A}/documents/current`,"/api/v1/auth/refresh",`/api/v1/workspaces/${A}/documents/current`]);
    expect(calls.every(call=>!call.headers.has("X-Workspace-ID"))).toBe(true);
    expect(calls[2].headers.get("Authorization")).toBe("Bearer context-rotated");expect(authStore.getState().workspace?.id).toBe(B);
  });
  it("scopes document and membership wrappers to the captured workspace",async()=>{
    const fetch=vi.fn(async(url:string)=>response(url.includes("/members")?{items:[],pagination:{page:1,page_size:20,total:0}}:{id:USER,workspace_id:A,collection_id:A,parent_id:null,position:0,title:"文档",content_version:1,is_archived:false,archived_at_ms:null,created_at_ms:1,updated_at_ms:1}));vi.stubGlobal("fetch",fetch);
    const {result}=renderHook(useAuthRequest);await getNote(USER,result.current);await listMembers(result.current);
    expect(fetch.mock.calls.every(([url])=>url.startsWith(`/api/v1/workspaces/${A}/`))).toBe(true);
  });
  it("discovers memberships globally and persists the preference through the account endpoint",async()=>{
    const fetch=vi.fn(async(url:string,init:RequestInit)=>{
      expect(new Headers(init.headers).has("X-Workspace-ID")).toBe(false);
      if(url.includes("/workspaces?"))return response({items:[workspace],pagination:{page:1,page_size:100,total:1}});
      if(url.endsWith("/workspace-preference")){expect(init.method).toBe("PUT");expect(JSON.parse(String(init.body))).toEqual({workspace_id:A});}
      return response(user);
    });vi.stubGlobal("fetch",fetch);const {result}=renderHook(useAuthRequest);
    await listWorkspaces(result.current);await switchWorkspace(A,result.current);await getProfile(result.current);
    expect(fetch.mock.calls.map(([url])=>url)).toContain("/api/v1/me");
  });
  it("updates account preferences without changing this tab's selected workspace",()=>{
    const before=getAuthSessionKey(authStore.getState());
    act(()=>authStore.getState().updateUser({...user,display_name:"新名称",profile_version:2,preferred_workspace_id:B},before));
    expect(getAuthSessionKey(authStore.getState())).toBe(before);
    expect(authStore.getState().user?.preferred_workspace_id).toBe(B);expect(authStore.getState().workspace?.id).toBe(A);
    expect(JSON.parse(localStorage.getItem("orbis.auth.v2")!).workspace.id).toBe(A);
  });
});
