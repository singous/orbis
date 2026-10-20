import {z} from "zod";
import {ApiError,apiRequest,workspacePath} from "../../shared/api/api-client";
import {paginationSchema} from "../../shared/api/schemas";
import {authRequestOptions,type AuthRequestOptions} from "../../shared/auth/use-auth-request";
import {searchWorkspace} from "../search/api";
import {siteReleaseListSchema,type SiteConfig} from "./schemas";
import {nativeSite,nativePreview,nativeSources,wireSiteConfig} from "./site-codec";
const sitePath=(id:string,auth:AuthRequestOptions)=>workspacePath(auth,`/sites/${id}`);
export async function listSites(auth:AuthRequestOptions,page=1){const data=z.object({items:z.array(z.unknown()),pagination:paginationSchema}).parse(await apiRequest(workspacePath(auth,`/sites?page=${page}&page_size=20`),authRequestOptions(auth)));return {...data,items:data.items.map(nativeSite)};}
export async function getSite(id:string,auth:AuthRequestOptions){return nativeSite(await apiRequest(sitePath(id,auth),authRequestOptions(auth)));}
export async function createSite(config:SiteConfig,auth:AuthRequestOptions){return nativeSite(await apiRequest(workspacePath(auth,"/sites"),{...authRequestOptions(auth),method:"POST",body:wireSiteConfig(config)}));}
export async function saveSite(id:string,config:SiteConfig,expectedVersion:number,auth:AuthRequestOptions){return nativeSite(await apiRequest(sitePath(id,auth),{...authRequestOptions(auth),method:"PUT",body:{...wireSiteConfig(config),expected_version:expectedVersion}}));}
export async function previewSite(id:string,auth:AuthRequestOptions){return nativePreview(await apiRequest(`${sitePath(id,auth)}/preview`,authRequestOptions(auth)),auth.workspaceId??undefined);}
export async function getSiteSources(id:string,auth:AuthRequestOptions){return nativeSources(await apiRequest(`${sitePath(id,auth)}/sources`,authRequestOptions(auth)));}
async function post(id:string,suffix:string,body:Record<string,unknown>,auth:AuthRequestOptions){
  let uncertain=false;
  for(let attempt=0;attempt<2;attempt+=1){
    try{return nativeSite(z.object({site:z.unknown()}).parse(await apiRequest(`${sitePath(id,auth)}${suffix}`,{...authRequestOptions(auth),method:"POST",body})).site);}
    catch(error){const rejected=error instanceof ApiError&&error.status>=400&&error.status<500;if(rejected&&!uncertain)throw error;uncertain=true;if(attempt===1||rejected)throw new ApiError(503,"站点操作结果尚未确认，请重试原操作。","SITE_OPERATION_RESULT_UNKNOWN","",{operation_id:body.operation_id});}
  }
  throw new Error("Unreachable site command recovery");
}
export function publishSite(id:string,auth:AuthRequestOptions,input:{operation_id:string;expected_version:number;expected_source_fingerprint:string}){return post(id,"/publish",input,auth);}
export async function listSiteReleases(id:string,auth:AuthRequestOptions,page=1){return siteReleaseListSchema.parse(await apiRequest(`${sitePath(id,auth)}/releases?page=${page}&page_size=20`,authRequestOptions(auth)));}
export function activateSiteRelease(id:string,releaseId:string,auth:AuthRequestOptions,expectedVersion:number,operationId:string){return post(id,"/activation",{operation_id:operationId,expected_version:expectedVersion,release_id:releaseId},auth);}
export function unpublishSite(id:string,auth:AuthRequestOptions,expectedVersion:number,operationId:string){return post(id,"/activation",{operation_id:operationId,expected_version:expectedVersion,release_id:null},auth);}
export async function listPublishableNotes(query:string,page:number,auth:AuthRequestOptions){
  if(query.trim()){const data=await searchWorkspace({q:query,type:"document",status:"active",page},auth);return {...data,items:data.items.map(item=>({id:item.id,title:item.title,plain_text:item.snippet}))};}
  const data=z.object({items:z.array(z.object({id:z.string().uuid(),title:z.string(),summary:z.string()})),pagination:paginationSchema}).parse(await apiRequest(workspacePath(auth,`/documents?page=${page}&page_size=20`),authRequestOptions(auth)));
  return {...data,items:data.items.map(item=>({id:item.id,title:item.title,plain_text:item.summary}))};
}
