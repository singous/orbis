import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
const api=`http://127.0.0.1:${process.env.ORBIS_E2E_API_PORT||'9311'}`;
const credentials={email:'owner@example.com',password:'Orbis-browser-test-2026!'};
const paragraph=(id:string,text:string)=>({id,type:'paragraph',props:{},content:[{type:'text',text,styles:{}}],children:[]});
async function prepare(page:Page,request:APIRequestContext,blocks:unknown[]=[paragraph('a','Alpha block'),paragraph('b','Beta block'),paragraph('c','Gamma block')]) {
 let auth=await request.post(`${api}/setup`,{data:{...credentials,display_name:'Block acceptance'}});
 if(auth.status()===409)auth=await request.post(`${api}/auth/login`,{data:credentials});
 expect(auth.ok()).toBeTruthy();
 const headers={Authorization:`Bearer ${(await auth.json()).data.access_token}`};
 const notebook=(await(await request.post(`${api}/notebooks`,{headers,data:{title:'Block acceptance'}})).json()).data;
 const note=(await(await request.post(`${api}/notes`,{headers,data:{notebook_id:notebook.id,title:'Block interaction acceptance'}})).json()).data;
 expect((await request.put(`${api}/notes/${note.id}/content`,{headers,data:{expected_version:1,blocks:{schema_version:2,editor:'blocknote',blocks}}})).ok()).toBeTruthy();
 await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(credentials.email);await page.getByLabel('密码',{exact:true}).fill(credentials.password);await page.getByRole('button',{name:'登录 Orbis'}).click();await page.waitForURL('**/documents');
 await page.goto(`/documents/${note.id}`);await expect(page.locator('.ProseMirror')).toBeVisible();
 return {note,notebook,headers,read:async()=>(await(await request.get(`${api}/notes/${note.id}/content`,{headers})).json()).data};
}
async function handle(page:Page,text:string,modifiers:('Shift'|'Control'|'Meta')[]=[]) {
 await page.locator('.ProseMirror').getByText(text,{exact:true}).hover();
 await page.getByRole('button',{name:/^块操作：/}).click({modifiers});
}

test('multi-block grouping, duplication, nesting and history survive saving and reload',async({page,request},info)=>{
 const {read}=await prepare(page,request);
 await handle(page,'Alpha block');await page.keyboard.press('Escape');
 await handle(page,'Gamma block',['Shift']);
 await expect(page.locator('[data-orbis-selected="true"]')).toHaveCount(3);
 // Clicking an already-selected handle should preserve the whole selection.
 await page.getByRole('button',{name:/^块操作：/}).click();
 await page.getByRole('menuitem',{name:'组合',exact:true}).click();
 await expect.poll(async()=>(await read()).blocks.blocks[0].type).toBe('group');
 let stored=(await read()).blocks.blocks;
 expect(stored).toHaveLength(1);expect(stored[0].children.map((block:{id:string})=>block.id)).toEqual(['a','b','c']);
 await page.reload();await expect(page.locator('[data-document-component="group"]')).toBeVisible();
 // Parent navigation makes transparent containers reachable without a tiny hit target.
 const group=page.locator('[data-document-component="group"]');await group.hover({position:{x:2,y:2}});
 await page.getByRole('button',{name:/^块操作：/}).click();
 const parent=page.getByRole('menuitem',{name:/选择父块：/});
 if(await parent.count())await parent.click();
 await page.getByRole('menuitem',{name:'取消组合',exact:true}).click();
 await expect.poll(async()=>(await read()).blocks.blocks.map((block:{id:string})=>block.id).join(',')).toBe('a,b,c');
 await page.keyboard.press('Escape');
 await handle(page,'Beta block');await page.getByRole('menuitem',{name:'增加缩进',exact:true}).click();
 await expect.poll(async()=>(await read()).blocks.blocks[0].children[0]?.id).toBe('b');
 await page.getByRole('toolbar',{name:'文档格式'}).getByRole('button',{name:'撤销',exact:true}).click();
 await expect.poll(async()=>(await read()).blocks.blocks.map((block:{id:string})=>block.id).join(',')).toBe('a,b,c');
 await handle(page,'Alpha block');await page.getByRole('menuitem',{name:'创建副本',exact:true}).click();
 await expect.poll(async()=>(await read()).blocks.blocks.length).toBe(4);
 stored=(await read()).blocks.blocks;expect(new Set(stored.map((block:{id:string})=>block.id)).size).toBe(4);
});

test('dragging uses an explicit drop position and preserves block IDs',async({page,request})=>{
 const {read}=await prepare(page,request);
 await page.locator('.ProseMirror').getByText('Alpha block',{exact:true}).hover();
 const grip=page.getByRole('button',{name:/^块操作：/});
 const last=page.locator('.ProseMirror').getByText('Gamma block',{exact:true});
 const bounds=(await last.boundingBox())!;
 await grip.dragTo(last,{targetPosition:{x:4,y:bounds.height-2}});
 await expect.poll(async()=>(await read()).blocks.blocks.map((block:{id:string})=>block.id).join(',')).toBe('b,c,a');
 await page.getByRole('toolbar',{name:'文档格式'}).getByRole('button',{name:'撤销',exact:true}).click();
 await expect.poll(async()=>(await read()).blocks.blocks.map((block:{id:string})=>block.id).join(',')).toBe('a,b,c');
});

test('block clipboard copies rich children across documents and block links locate their targets',async({page,request,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 const {note,notebook,headers}=await prepare(page,request,[{id:'card',type:'card',props:{title:'Reference card',href:'https://example.com/guide'},content:[],children:[paragraph('body','Preserve the card body')]},paragraph('other','Another block')]);
 await page.locator('.doc-editor-title').getByText('Reference card',{exact:true}).hover();
 await page.getByRole('button',{name:/^块操作：/}).click();
 await page.getByRole('menuitem',{name:'复制块',exact:true}).click();
 await expect(page.locator('.orbis-block-notice')).toContainText('已复制');
 const destination=(await(await request.post(`${api}/notes`,{headers,data:{notebook_id:notebook.id,title:'Paste destination'}})).json()).data;
 await page.goto(`/documents/${destination.id}`);await page.locator('.ProseMirror').click();await page.keyboard.press('ControlOrMeta+V');
 const read=async()=>(await(await request.get(`${api}/notes/${destination.id}/content`,{headers})).json()).data;
 await expect.poll(async()=>(await read()).plain_text).toContain('Preserve the card body');
 const card=(await read()).blocks.blocks.find((block:{type:string})=>block.type==='card');
 expect(card.props).toMatchObject({title:'Reference card',href:'https://example.com/guide'});expect(card.id).not.toBe('card');expect(card.children[0].id).not.toBe('body');
 await page.goto(`/documents/${note.id}#block-other`);
 await expect(page.locator('[data-orbis-target="true"]')).toHaveText('Another block');
});

test('legacy block links survive reload without rewriting the stored document',async({page,request})=>{
 const {note,headers,read}=await prepare(page,request);
 expect((await request.put(`${api}/notes/${note.id}/content`,{headers,data:{expected_version:2,blocks:{schema_version:1,editor:'tiptap',doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Legacy block target'}]}]}}}})).ok()).toBeTruthy();
 await page.reload();
 const target=page.locator('.ProseMirror > p');await expect(target).toHaveText('Legacy block target');
 const id=await target.getAttribute('data-orbis-block-id');expect(id).toMatch(/^legacy-/);
 await page.goto(`/documents/${note.id}#block-${id}`);
 await expect(page.locator('[data-orbis-target="true"]')).toHaveText('Legacy block target');
 const stored=await read();expect(stored.blocks.schema_version).toBe(1);expect(stored.content_version).toBe(3);
});
