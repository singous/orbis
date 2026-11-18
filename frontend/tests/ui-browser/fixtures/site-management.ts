import type { Page } from "@playwright/test";

const id=(n: number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=Date.parse('2026-11-01T00:00:00Z'),wid=id(2),sid=id(3),nid=id(4),parentId=id(5),childId=id(6),rid=id(7),fingerprint='a'.repeat(64);
const user={id:id(1),email:'owner@example.com',display_name:'测试成员',bio:null,avatar_asset_id:null,preferred_workspace_id:wid,profile_version:1,created_at_ms:1,updated_at_ms:now};
const workspace={id:wid,name:'站点测试空间',role:'owner',created_at_ms:1,updated_at_ms:now};
const branding={logo:null,links:[{label:'产品首页',url:'https://example.com'}],footer_links:[{label:'联系我们',url:'https://example.com/contact'}],cta:{label:'开始使用',url:'https://example.com/start'},theme:'light'};
const site={id:sid,workspace_id:wid,name:'产品手册',slug:'guide',description:'产品知识与操作指南',site_kind:'handbook',accent_color:'#0f766e',navigation:[{document_id:parentId,slug:'getting-started',title:'开始使用',group:'指南'},{document_id:childId,slug:'install',title:'安装客户端',group:null}],source:{kind:'collections',collections:[{collection_id:nid,root_document_id:null,label:'产品知识库'}],excluded_document_ids:[],page_overrides:[{document_id:parentId,title:'公开入门',slug:'getting-started',description:'公开简介'}]},branding,version:2,published_release_id:rid,published_slug:'guide',created_at_ms:1,updated_at_ms:now};
const notebook={id:nid,workspace_id:wid,group_id:id(8),title:'产品知识库',sort_order:0,icon:null,metadata_version:1,directory_version:7,is_archived:false,archived_at_ms:null,created_at_ms:1,updated_at_ms:now};
const parent={id:parentId,workspace_id:wid,collection_id:nid,parent_id:null,position:0,title:'开始使用',content_version:2,is_archived:false,archived_at_ms:null,created_at_ms:1,updated_at_ms:now,summary:'入门摘要'};
const child={...parent,id:childId,parent_id:parentId,position:0,title:'安装客户端'};
const sourcePage={document_id:parentId,content_version:2,slug:'getting-started',title:'公开入门',group:'指南',parent_slug:null,section:'产品知识库',description:'公开简介',updated_at_ms:now};
const sources={pages:[sourcePage],excluded_count:0,source_fingerprint:fingerprint,changes:{added:[sourcePage],modified:[],removed:[]}};
const previewPage={...sourcePage,plain_text:'冻结正文',blocks:[{id:'preview-content',type:'paragraph',props:{},content:[{text:'冻结正文',marks:[],href:null}],children:[]}]};
const preview={snapshot:{name:site.name,slug:site.slug,description:site.description,site_kind:site.site_kind,accent_color:site.accent_color,branding:{...branding,logo_url:null},pages:[sourcePage],redirects:{},release_id:null,release_number:null,published_at_ms:null},pages:[previewPage],source_fingerprint:fingerprint};
const dataPage=(items: unknown[])=>({items,pagination:{page:1,page_size:20,total:items.length}});

export const siteManagementSiteId = sid;

export async function installSiteManagementFixture(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript(({ user, workspace, theme, now }) => {
    Date.now = () => now;
    localStorage.setItem("orbis.auth.v2", JSON.stringify({ user, workspace, accessToken: "sites-ui", refreshToken: "refresh", credentialID: "sites-ui" }));
    localStorage.setItem("orbis.appearance", theme);
  }, { user, workspace, theme, now });
  const mutations: { method: string; path: string; body: unknown }[] = [];
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = dataPage([]);
    if (route.request().method() !== "GET") mutations.push({ method: route.request().method(), path: url.pathname, body: route.request().postDataJSON() });
    if (url.pathname.endsWith(`/sites/${sid}/sources`)) data = sources;
    else if (url.pathname.endsWith(`/sites/${sid}/preview`)) data = preview;
    else if (url.pathname.endsWith(`/sites/${sid}/releases`)) data = dataPage([{ id: rid, release_number: 1, published_at_ms: now, is_active: true }]);
    else if (url.pathname.endsWith(`/sites/${sid}`)) data = site;
    else if (url.pathname.endsWith("/sites")) data = dataPage([site, { ...site, id: id(9), name: "团队知识", slug: "team", published_release_id: null, published_slug: null }]);
    else if (url.pathname.endsWith("/collections")) data = dataPage([notebook]);
    else if (url.pathname.endsWith(`/collections/${nid}`)) data = notebook;
    else if (url.pathname.endsWith(`/collections/${nid}/documents`)) data = dataPage([parent, child]);
    else if (url.pathname.endsWith("/documents")) data = dataPage([parent, child]);
    else if (url.pathname === "/api/v1/me") data = user;
    await route.fulfill({ json: { code: "OK", message: "", request_id: "sites-parity", data } });
  });
  return mutations;
}
