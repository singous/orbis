import {z} from "zod";
import {publicEditorBlocks,privatePreviewLink} from "../content/codecs/public-content";
import {siteConfigSchema,siteSchema,siteSnapshotSchema,siteSourcesSchema,publicPageSchema,type SiteConfig} from "./schemas";
const link=z.object({label:z.string(),url:z.string()});
const media=z.discriminatedUnion("type",[z.object({type:z.literal("asset"),asset_id:z.string().uuid()}),z.object({type:z.literal("external"),url:z.string()})]);
const config=z.object({name:z.string(),slug:z.string(),description:z.string(),site_kind:z.enum(["knowledge","handbook","help"]),accent_color:z.string(),navigation:z.array(z.object({document_id:z.string().uuid(),slug:z.string(),title:z.string(),group:z.string().nullable()})),source:z.object({kind:z.enum(["manual","collections"]),collections:z.array(z.object({collection_id:z.string().uuid(),root_document_id:z.string().uuid().nullable(),label:z.string().nullable()})),excluded_document_ids:z.array(z.string().uuid()),page_overrides:z.array(z.object({document_id:z.string().uuid(),title:z.string().nullable(),slug:z.string().nullable(),description:z.string().nullable()}))}),branding:z.object({logo:media.nullable(),links:z.array(link),footer_links:z.array(link),cta:link.nullable(),theme:z.enum(["system","light","dark"])})});
const editorAssetLink=(value:string)=>value.startsWith("asset:")?`orbis-file:${value.slice(6)}`:value;
const wireAssetLink=(value:string)=>value.startsWith("orbis-file:")?`asset:${value.slice(11)}`:value;
function configView(value:z.infer<typeof config>){
  return siteConfigSchema.parse({...value,navigation:value.navigation.map(item=>({...item,note_id:item.document_id})),source:{kind:value.source.kind==="collections"?"notebooks":"manual",notebooks:value.source.collections.map(item=>({notebook_id:item.collection_id,root_note_id:item.root_document_id,label:item.label})),excluded_note_ids:value.source.excluded_document_ids,page_overrides:value.source.page_overrides.map(item=>({...item,note_id:item.document_id}))},branding:{...value.branding,links:value.branding.links.map(item=>({...item,url:editorAssetLink(item.url)})),footer_links:value.branding.footer_links.map(item=>({...item,url:editorAssetLink(item.url)})),cta:value.branding.cta?{...value.branding.cta,url:editorAssetLink(value.branding.cta.url)}:null,logo_url:value.branding.logo===null?null:value.branding.logo.type==="asset"?`orbis-file:${value.branding.logo.asset_id}`:value.branding.logo.url}});
}
export function nativeSite(raw:unknown){
  const value=config.extend({id:z.string().uuid(),workspace_id:z.string().uuid(),version:z.number().int().positive(),published_release_id:z.string().uuid().nullable(),published_slug:z.string().nullable(),created_at_ms:z.number().int(),updated_at_ms:z.number().int()}).parse(raw);
  return siteSchema.parse({...configView(value),...{id:value.id,config_version:value.version,published_release_id:value.published_release_id,published_slug:value.published_slug,created_at_ms:value.created_at_ms,updated_at_ms:value.updated_at_ms}});
}
export function wireSiteConfig(input:SiteConfig){
  const source=input.source??{kind:"manual",notebooks:[],excluded_note_ids:[],page_overrides:[]};
  const branding=input.branding??{logo_url:null,links:[],footer_links:[],cta:null,theme:"system"};
  const logo=branding.logo_url;
  return {name:input.name,slug:input.slug,description:input.description,site_kind:input.site_kind,accent_color:input.accent_color,navigation:input.navigation.map(item=>({document_id:item.note_id,slug:item.slug,title:item.title,group:item.group})),source:{kind:source.kind==="notebooks"?"collections":"manual",collections:source.notebooks.map(item=>({collection_id:item.notebook_id,root_document_id:item.root_note_id??null,label:item.label??null})),excluded_document_ids:source.excluded_note_ids,page_overrides:source.page_overrides.map(item=>({document_id:item.note_id,title:item.title??null,slug:item.slug??null,description:item.description??null}))},branding:{logo:!logo?null:logo.startsWith("orbis-file:")?{type:"asset",asset_id:logo.slice(11)}:{type:"external",url:logo},links:branding.links.map(item=>({...item,url:wireAssetLink(item.url)})),footer_links:branding.footer_links.map(item=>({...item,url:wireAssetLink(item.url)})),cta:branding.cta?{...branding.cta,url:wireAssetLink(branding.cta.url)}:null,theme:branding.theme}};
}
export const nativePageMetadata=z.object({slug:z.string(),title:z.string(),group:z.string().nullable(),parent_slug:z.string().nullable(),section:z.string().nullable(),description:z.string(),updated_at_ms:z.number().int().nullable()});
const snapshotSchema=z.object({name:z.string(),slug:z.string(),description:z.string(),site_kind:z.enum(["knowledge","handbook","help"]),accent_color:z.string(),branding:z.object({logo_url:z.string().nullable(),links:z.array(link),footer_links:z.array(link),cta:link.nullable(),theme:z.enum(["system","light","dark"])}),pages:z.array(nativePageMetadata),redirects:z.record(z.string()),release_id:z.string().uuid().nullable(),release_number:z.number().int().positive().nullable(),published_at_ms:z.number().int().nullable()});
export function nativeManifest(raw:unknown){return snapshotSchema.parse(raw);}
export function nativePage(raw:unknown,workspaceId?:string){
  const page=nativePageMetadata.extend({blocks:z.unknown(),plain_text:z.string()}).parse(raw);
  return publicPageSchema.parse({...page,blocks:publicEditorBlocks(page.blocks,workspaceId)});
}
export function nativePreview(raw:unknown,workspaceId?:string){
  const value=z.object({snapshot:snapshotSchema,pages:z.array(z.unknown()),source_fingerprint:z.string()}).parse(raw);
  return {...siteSnapshotSchema.parse({...value.snapshot,branding:{...value.snapshot.branding,logo_url:privatePreviewLink(value.snapshot.branding.logo_url,workspaceId),links:value.snapshot.branding.links.map(item=>({...item,url:privatePreviewLink(item.url,workspaceId)!})),footer_links:value.snapshot.branding.footer_links.map(item=>({...item,url:privatePreviewLink(item.url,workspaceId)!})),cta:value.snapshot.branding.cta?{...value.snapshot.branding.cta,url:privatePreviewLink(value.snapshot.branding.cta.url,workspaceId)!}:null},pages:value.pages.map(page=>nativePage(page,workspaceId))}),source_fingerprint:value.source_fingerprint};
}
export function nativeSources(raw:unknown){
  const page=nativePageMetadata.extend({document_id:z.string(),content_version:z.number().int().positive()});
  const value=z.object({pages:z.array(page),excluded_count:z.number().int(),source_fingerprint:z.string(),changes:z.object({added:z.array(page),modified:z.array(page),removed:z.array(page)})}).parse(raw);
  const view=(item:z.infer<typeof page>)=>({...item,note_id:item.document_id});
  return siteSourcesSchema.parse({...value,pages:value.pages.map(view),changes:{added:value.changes.added.map(view),modified:value.changes.modified.map(view),removed:value.changes.removed.map(view)}});
}
