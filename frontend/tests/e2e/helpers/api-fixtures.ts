import {expect,type APIRequestContext,type APIResponse,type Page} from "@playwright/test";

export const ownerCredentials={email:"owner@example.com",password:"Orbis-browser-test-2026!"};
export type TestWorkspace={id:string;name:string;role:"owner"|"admin"|"editor"|"viewer";created_at_ms:number;updated_at_ms:number};
export type TestSession={access_token:string;refresh_token:string;user:{id:string;preferred_workspace_id:string|null;[field:string]:unknown};workspace:TestWorkspace};
export async function responseData<T=Record<string,any>>(response:APIResponse):Promise<T>{
  expect(response.ok(),"Fixture request must succeed").toBe(true);
  const value=await response.json();expect(value.code).toMatch(/^(OK|CREATED|ACCEPTED)$/);return value.data as T;
}
export async function ownerSession(request:APIRequestContext,displayName="浏览器验收"):Promise<TestSession>{
  const setup=await request.post("/api/v1/setup",{data:{...ownerCredentials,display_name:displayName,workspace_name:"浏览器测试空间"}});
  expect([201,409]).toContain(setup.status());
  const tokens=await responseData<Omit<TestSession,"workspace">>(await request.post("/api/v1/auth/login",{data:ownerCredentials}));
  const spaces=await responseData<{items:TestWorkspace[]}>(await request.get("/api/v1/workspaces?page=1&page_size=100",{headers:{Authorization:`Bearer ${tokens.access_token}`}}));
  const workspace=spaces.items.find(item=>item.id===tokens.user.preferred_workspace_id)??spaces.items[0];
  expect(workspace,"Synthetic owner must have a test workspace").toBeDefined();
  return {...tokens,workspace};
}
export async function sessionFromPage(page:Page):Promise<TestSession>{
  return page.evaluate(()=>{
    const state=JSON.parse(localStorage.getItem("orbis.auth.v2")!);
    return {access_token:state.accessToken,refresh_token:state.refreshToken,user:state.user,workspace:state.workspace};
  });
}
export function workspacePath(session:Pick<TestSession,"workspace">,suffix:string){return `/api/v1/workspaces/${session.workspace.id}${suffix}`;}
export function sessionHeaders(session:Pick<TestSession,"access_token">){return {Authorization:`Bearer ${session.access_token}`};}
export async function createCollection(request:APIRequestContext,session:TestSession,title:string,groupId?:string){
  return responseData(await request.post(workspacePath(session,"/collections"),{headers:sessionHeaders(session),data:{title,sort_order:0,...(groupId?{group_id:groupId}:{})}}));
}
export async function createDocument(request:APIRequestContext,session:TestSession,collectionId:string,title="未命名文档",parentId:string|null=null){
  return responseData(await request.post(workspacePath(session,`/collections/${collectionId}/documents`),{headers:sessionHeaders(session),data:{title,parent_id:parentId}}));
}
export async function openWithSession(page:Page,session:TestSession,path:string){
  await page.goto("/login");
  await page.evaluate(value=>localStorage.setItem("orbis.auth.v2",JSON.stringify({accessToken:value.access_token,refreshToken:value.refresh_token,user:value.user,workspace:value.workspace,credentialID:crypto.randomUUID()})),session);
  await page.goto(path);
}
