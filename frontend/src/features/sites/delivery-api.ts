import {z} from "zod";
import {ApiError,apiRequest} from "../../shared/api/api-client";
import {paginationSchema} from "../../shared/api/schemas";
import {siteManifestSchema} from "./delivery-schemas";
import {nativeManifest,nativePage} from "./site-codec";
export function encodedPagePath(slug:string){return slug.split("/").map(encodeURIComponent).join("/");}
function expectedRelease(id:string|null){return id?`?${new URLSearchParams({release_id:id})}`:"";}
export async function getSiteManifest(slug:string,signal?:AbortSignal){return siteManifestSchema.parse(nativeManifest(await apiRequest(`/v1/public/sites/${encodeURIComponent(slug)}/manifest`,{signal})));}
export async function getPublicPage(slug:string,pageSlug:string,releaseId:string|null,signal?:AbortSignal){
  const page=nativePage(await apiRequest(`/v1/public/sites/${encodeURIComponent(slug)}/pages/${encodedPagePath(pageSlug)}${expectedRelease(releaseId)}`,{signal}));
  return {release_id:releaseId,page};
}
export async function getPublicSearch(slug:string,releaseId:string|null,query:string,signal?:AbortSignal){
  const schema=z.object({release_id:z.string().uuid(),items:z.array(z.object({slug:z.string(),title:z.string(),plain_text:z.string()})),pagination:paginationSchema});
  const pages:Array<z.infer<typeof schema>["items"][number]>=[];
  for(let page=1;page<=2;page+=1){
    const params=new URLSearchParams({q:query,page:String(page),page_size:"100"});if(releaseId)params.set("release_id",releaseId);
    const data=schema.parse(await apiRequest(`/v1/public/sites/${encodeURIComponent(slug)}/search?${params}`,{signal}));
    if(data.release_id!==releaseId)throw new ApiError(409,"发布版本已变化，请刷新文档。","SITE_RELEASE_CHANGED");
    pages.push(...data.items);if(!data.pagination.has_next)return {release_id:data.release_id,pages};
  }
  throw new Error("搜索结果超过站点页面上限。");
}
export async function getPublicMarkdown(slug:string,pageSlug:string,releaseId:string|null):Promise<string>{
  const response=await fetch(`/s/${encodeURIComponent(slug)}/pages/${encodedPagePath(pageSlug)}.md${expectedRelease(releaseId)}`,{cache:"no-store",redirect:"error"});
  if(!response.ok)throw new ApiError(response.status,response.status===409?"发布版本已变化，请刷新后再复制。":"无法读取页面 Markdown，请重试。",response.status===409?"SITE_RELEASE_CHANGED":"SITE_EXPORT_FAILED");
  if(!/^text\/(markdown|plain)(?:;|$)/i.test(response.headers.get("Content-Type")??""))throw new Error("未收到有效的页面 Markdown");
  return response.text();
}
