import {afterEach,expect,it,vi} from "vitest";
import {createSite,publishSite,previewSite} from "./api";
import {wireSiteConfig} from "./site-codec";
import type {AuthRequestOptions} from "../../shared/auth/use-auth-request";
import type {SiteConfig} from "./schemas";
const id=(n:string)=>"00000000-0000-4000-8000-"+n.padStart(12,"0");
const wid=id("1"),sid=id("2"),cid=id("3"),did=id("4"),asset=id("5"),release=id("6"),operation=id("7");
const auth:AuthRequestOptions={accessToken:"access",refreshToken:null,workspaceId:wid,onTokenRefresh:vi.fn(),onUnauthorized:vi.fn()};
const config:SiteConfig={name:"站点",slug:"site",description:"简介",site_kind:"knowledge",accent_color:"#0f766e",navigation:[],source:{kind:"notebooks",notebooks:[{notebook_id:cid,root_note_id:did,label:null}],excluded_note_ids:[],page_overrides:[]},branding:{logo_url:`orbis-file:${asset}`,links:[],footer_links:[],cta:null,theme:"system"}};
const site={...wireSiteConfig(config),id:sid,workspace_id:wid,version:2,published_release_id:release,published_slug:"site",created_at_ms:1,updated_at_ms:2};
function response(data:unknown){return new Response(JSON.stringify({code:"OK",message:"成功",request_id:"req",data}),{headers:{"Content-Type":"application/json"}});}
afterEach(()=>vi.unstubAllGlobals());
it("uses native collection source and structured logo contracts",async()=>{
  const fetchMock=vi.fn().mockResolvedValue(response(site));vi.stubGlobal("fetch",fetchMock);
  const created=await createSite(config,auth);
  expect(created.config_version).toBe(2);
  expect(created.source?.notebooks[0].notebook_id).toBe(cid);
  const body=JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.source.kind).toBe("collections");
  expect(body.source.collections[0]).toEqual({collection_id:cid,root_document_id:did,label:null});
  expect(body.branding.logo).toEqual({type:"asset",asset_id:asset});
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/v1/workspaces/${wid}/sites`);
});
it("publishes the original reviewed fingerprint/version/UUID after response loss",async()=>{
  const fetchMock=vi.fn().mockRejectedValueOnce(new TypeError("lost")).mockResolvedValueOnce(response({site,release:{id:release,release_number:1,published_at_ms:2,is_active:true}}));vi.stubGlobal("fetch",fetchMock);
  await publishSite(sid,auth,{operation_id:operation,expected_version:1,expected_source_fingerprint:"a".repeat(64)});
  expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({operation_id:operation,expected_version:1,expected_source_fingerprint:"a".repeat(64)});
});
it("keeps preview assets authenticated and unknown source times nullable",async()=>{
  const metadata={slug:"page",title:"页面",group:null,parent_slug:null,section:null,description:"",updated_at_ms:null};
  const snapshot={name:"站点",slug:"site",description:"",site_kind:"knowledge",accent_color:"#0f766e",branding:{logo_url:`/api/v1/workspaces/${wid}/assets/${asset}/content`,links:[{label:"附件",url:`/api/v1/workspaces/${wid}/assets/${asset}/content`}],footer_links:[],cta:{label:"下载",url:`/api/v1/workspaces/${wid}/assets/${asset}/content`},theme:"system"},pages:[metadata],redirects:{},release_id:null,release_number:null,published_at_ms:null};
  const blocks=[{id:"public-0",type:"image",props:{source:{type:"external",url:`/api/v1/workspaces/${wid}/assets/${asset}/content`}},content:[],children:[]}];
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response({snapshot,pages:[{...metadata,blocks,plain_text:""}],source_fingerprint:"a".repeat(64)})));
  const preview=await previewSite(sid,auth);
  expect(preview.branding?.logo_url).toBe(`orbis-file:${asset}`);
  expect(preview.branding?.links[0].url).toBe(`orbis-file:${asset}`);
  expect(preview.branding?.cta?.url).toBe(`orbis-file:${asset}`);
  expect(preview.pages[0].updated_at_ms).toBeNull();
  expect(preview.pages[0].blocks).toMatchObject({blocks:[{id:"public-0",props:{url:`orbis-file:${asset}`}}]});
});

it("serializes private branding attachments as native asset links",async()=>{
  const branding={...config.branding!,links:[{label:"附件",url:`orbis-file:${asset}`}],footer_links:[{label:"页脚",url:`orbis-file:${asset}`}],cta:{label:"下载",url:`orbis-file:${asset}`}};
  const raw={...site,branding:{...site.branding,links:[{label:"附件",url:`asset:${asset}`}],footer_links:[],cta:{label:"下载",url:`asset:${asset}`}}};
  const fetchMock=vi.fn().mockResolvedValue(response(raw));vi.stubGlobal("fetch",fetchMock);
  const created=await createSite({...config,branding},auth);
  const sent=JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(sent.branding.links[0].url).toBe(`asset:${asset}`);expect(sent.branding.footer_links[0].url).toBe(`asset:${asset}`);expect(sent.branding.cta.url).toBe(`asset:${asset}`);
  expect(created.branding?.links[0].url).toBe(`orbis-file:${asset}`);expect(created.branding?.cta?.url).toBe(`orbis-file:${asset}`);
});
