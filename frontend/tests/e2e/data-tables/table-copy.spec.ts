import {expect,test} from "@playwright/test";
import {ownerSession,openWithSession,createCollection,createDocument,workspacePath,sessionHeaders,responseData} from "../helpers/api-fixtures";

test("an initialized table duplicates atomically after a lost response and edits independently",async({page,request})=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const session=await ownerSession(request),collection=await createCollection(request,session,`表格复制 ${Date.now()}`);
  const note=await createDocument(request,session,collection.id,"表格复制验收"),headers=sessionHeaders(session);
  const path=workspacePath(session,`/documents/${note.id}`);
  const read=async()=>responseData(await request.get(`${path}/content`,{headers}));
  const metadata=await responseData(await request.get(path,{headers}));
  const collaborative=metadata.collaboration_available===true;
  const copies:string[]=[];
  let firstCopyOperation:string|null=null,lostAcknowledgement=false;
  if(collaborative)await page.routeWebSocket("**/api/v1/workspaces/*/documents/*/collaboration/socket",socket=>{
    const server=socket.connectToServer();
    socket.onMessage(message=>{
      const input=JSON.parse(String(message));
      if(input.type==="update"&&input.table_copies?.length){copies.push(String(message));firstCopyOperation??=input.operation_id;}
      server.send(message);
    });
    server.onMessage(message=>{
      const output=JSON.parse(String(message));
      if(output.type==="ack"&&output.operation_id===firstCopyOperation&&!lostAcknowledgement){
        lostAcknowledgement=true;
        void socket.close({code:1012,reason:"Synthetic lost durable acknowledgement"});
        return;
      }
      socket.send(message);
    });
  });
  const legacyBlock=crypto.randomUUID();
  await responseData(await request.put(`${path}/content`,{headers,data:{operation_id:crypto.randomUUID(),expected_version:metadata.content_version,title:"表格复制验收",blocks:[{id:legacyBlock,type:"data_table"}]}}));
  await responseData(await request.post(`${path}/tables`,{headers,data:{operation_id:crypto.randomUUID(),expected_document_version:(await responseData(await request.get(path,{headers}))).content_version,block_id:legacyBlock}}));
  await openWithSession(page,session,`/documents/${note.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.getByRole("tab",{name:"全部记录",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"添加记录",exact:true}).click();
  const title=page.getByRole("textbox",{name:"标题",exact:true});
  await title.fill("复制前尚未自动保存的内容");
  await title.press("Tab");
  const tableBlock=page.locator(".orbis-data-table").first();
  await tableBlock.hover({position:{x:3,y:3}});
  await page.getByRole("button",{name:"块操作：数据表",exact:true}).click();
  let receiptUnavailable=true;
  if(!collaborative){
    await page.route("**/api/v1/workspaces/*/documents/*/operations/*",route=>receiptUnavailable?route.abort("failed"):route.continue());
    await page.route("**/api/v1/workspaces/*/documents/*/operations",async route=>{
    const body=route.request().postData()!,input=JSON.parse(body);
    if(!input.table_copies?.length){await route.continue();return;}
    copies.push(body);
    if(copies.length===1){const committed=await route.fetch();expect(committed.status()).toBe(200);await route.abort("failed");}
    else await route.continue();
    });
  }
  await page.getByRole("menuitem",{name:"创建副本",exact:true}).click();
  if(collaborative){
    await expect.poll(()=>lostAcknowledgement).toBe(true);
    await expect.poll(()=>copies.length).toBe(2);
  }else{
    await expect(page.getByRole("alertdialog", { name: "网络异常，请稍后重试", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "本机修改", exact: true }).click();
    receiptUnavailable=false;
    await page.getByRole("button",{name:"重试保存",exact:true}).click();
  }
  await expect(page.locator(".orbis-data-table")).toHaveCount(2);
  await expect(page.getByRole("textbox",{name:"标题",exact:true})).toHaveCount(2);
  expect(copies).toHaveLength(2);expect(copies[1]).toBe(copies[0]);
  const saved=await read(),tables=saved.blocks.filter((block:any)=>block.type==="data_table");
  expect(tables).toHaveLength(2);
  expect(tables[0].props.table_id).not.toBe(tables[1].props.table_id);
  await page.getByRole("textbox",{name:"标题",exact:true}).nth(1).fill("只修改副本");
  await page.getByRole("textbox",{name:"标题",exact:true}).nth(1).press("Tab");
  const records=async(index:number)=>responseData(await request.get(`${path}/tables/${tables[index].props.table_id}/records?page=1&page_size=20`,{headers}));
  await expect.poll(async()=>JSON.stringify((await records(1)).items)).toContain("只修改副本");
  expect(JSON.stringify((await records(0)).items)).toContain("复制前尚未自动保存的内容");
  expect(JSON.stringify((await records(0)).items)).not.toContain("只修改副本");
  await page.reload();
  await expect(page.getByRole("textbox",{name:"标题",exact:true}).nth(1)).toHaveValue("只修改副本");
  await page.context().grantPermissions(["clipboard-read","clipboard-write"]);
  await page.locator(".orbis-data-table").first().hover({position:{x:3,y:3}});
  await page.getByRole("button",{name:"块操作：数据表",exact:true}).click();
  await page.getByRole("menuitem",{name:"复制块",exact:true}).click();
  await expect(page.getByRole("alertdialog", { name: /已复制/ })).toBeVisible();
  const destination=await createDocument(request,session,collection.id,"跨文档粘贴验收");
  await page.goto(`/documents/${destination.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+V");
  await expect(page.getByRole("textbox",{name:"标题",exact:true})).toHaveValue("复制前尚未自动保存的内容");
  const pasted=await responseData(await request.get(workspacePath(session,`/documents/${destination.id}/content`),{headers}));
  const pastedTable=pasted.blocks.find((block:any)=>block.type==="data_table");
  expect(pastedTable.props.table_id).not.toBe(tables[0].props.table_id);
  expect(pastedTable.props.table_id).not.toBe(tables[1].props.table_id);
  expect(errors).toEqual([]);
});
