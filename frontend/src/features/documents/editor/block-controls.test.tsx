import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Profiler } from 'react';
import * as tree from './blocks/block-tree';
import { requestBlockMenu } from './blocks/BlockControls';
import { TiptapEditor } from './TiptapEditor';
import type { NoteBlocksV2 } from '../../content/blocks';
const blocks:NoteBlocksV2={schema_version:2,editor:'blocknote',blocks:['First','Second'].map((text,index)=>({id:`b${index}`,type:'paragraph',props:{},content:[{type:'text',text}],children:[]}))};
const notify = vi.hoisted(() => vi.fn());
vi.mock("../../../shared/ui/Toast", async original => ({ ...await original<typeof import("../../../shared/ui/Toast")>(), showToast: notify }));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();notify.mockClear();});
async function menu(container:HTMLElement,index=0) {
 const paragraph=container.querySelectorAll('.ProseMirror > p')[index];
 fireEvent.pointerMove(paragraph,{clientX:100,clientY:100});
 const handle=await screen.findByRole('button',{name:'块操作：段落'});
 fireEvent.click(handle);
 return screen.findByRole('menu',{name:'块操作'});
}
it('duplicates and groups blocks through visible controls and keeps undo available',async()=>{
 let latest=blocks;
 const {container}=render(<TiptapEditor blocks={blocks} onChange={next=>{latest=next.blocks;}}/>);
 await screen.findByText('First');await menu(container);
 fireEvent.click(screen.getByRole('menuitem',{name:'创建副本'}));
 await waitFor(()=>expect(latest.blocks).toHaveLength(3));
 expect(latest.blocks[0].id).toBe('b0');expect(latest.blocks[1].id).not.toBe('b0');
 fireEvent.click(screen.getByRole('button',{name:'撤销'}));
 await waitFor(()=>expect(latest.blocks).toHaveLength(2));
 await menu(container);
 fireEvent.click(screen.getByRole('menuitem',{name:'组合'}));
 await waitFor(()=>expect(latest.blocks[0].type).toBe('group'));
 expect(latest.blocks[0].children[0].id).toBe('b0');
});
it('offers copying but no modifying actions in a readonly document',async()=>{
 const {container}=render(<TiptapEditor blocks={blocks} readOnly onChange={()=>{throw Error('readonly mutation');}}/>);
 await screen.findByText('First');await menu(container);
 expect(screen.getByRole('menuitem',{name:'复制块'})).toBeVisible();
 expect(screen.queryByRole('menuitem',{name:'删除'})).toBeNull();
 expect(screen.queryByRole('menuitem',{name:'创建副本'})).toBeNull();
});

it('closes the block menu before a second Escape exits block selection',async()=>{
 const {container}=render(<TiptapEditor blocks={blocks} onChange={()=>{}}/>);
 await screen.findByText('First');await menu(container);
 fireEvent.keyDown(screen.getByRole('menu',{name:'块操作'}),{key:'Escape'});
 expect(screen.queryByRole('menu',{name:'块操作'})).toBeNull();
 const editable=container.querySelector('.ProseMirror')!;
 expect(document.activeElement).toBe(editable);
 fireEvent.keyDown(editable,{key:'Escape'});
 expect(container.querySelector('[data-orbis-selected="true"]')).toBeNull();
});

it('does not delete an outer block when an embedded component button has focus', async () => {
 const data:NoteBlocksV2={...blocks,blocks:[{id:'card',type:'card',props:{title:'Interactive card'},content:[],children:[blocks.blocks[0]]}]};
 const {container}=render(<TiptapEditor blocks={data} onChange={()=>{}}/>);
 await screen.findByText('First');
 const editor=(container.querySelector('.ProseMirror') as HTMLElement & {editor:import('@tiptap/core').Editor}).editor;
 const {selectBlock}=await import('./blocks/block-selection');
 const original=editor.state.doc;
 act(()=>selectBlock(editor,'card'));
 const button=screen.getByRole('button',{name:'编辑卡片属性'});
 act(()=>button.focus());fireEvent.keyDown(button,{key:'Delete'});
 expect(editor.state.doc).toBe(original);
 expect(screen.getByText('First')).toBeVisible();
});

it('does not commit React or rebuild the menu index on ordinary inline input', async () => {
 const committed=vi.fn();
 const {container}=render(<Profiler id="live-editor" onRender={committed}><TiptapEditor blocks={blocks} onChange={()=>{}}/></Profiler>);
 await screen.findByText('First');
 const editor=(container.querySelector('.ProseMirror') as HTMLElement&{editor:import('@tiptap/core').Editor}).editor;
 await act(async()=>{editor.commands.setTextSelection(1);editor.view.focus();});
 await screen.findByRole('button',{name:'块操作：段落'});
 const previous=committed.mock.calls.length;
 const indexed=vi.spyOn(tree,'indexBlocks');
 for(const letter of 'abcdefghijklmnopqrst')act(()=>{editor.commands.insertContent(letter);});
 expect(editor.state.doc.textContent).toContain('abcdefghijklmnopqrst');
 expect(committed.mock.calls.length).toBe(previous);
 expect(indexed).not.toHaveBeenCalled();
});

it('reopens its menu on the current content and refreshes structural changes and selection', async () => {
 let latest=blocks;
 const {container}=render(<TiptapEditor blocks={blocks} onChange={next=>{latest=next.blocks;}}/>);
 await screen.findByText('First');
 const editor=(container.querySelector('.ProseMirror') as HTMLElement&{editor:import('@tiptap/core').Editor}).editor;
 act(()=>{editor.commands.setTextSelection(1);editor.view.focus();editor.commands.insertContent('Newest ');});
 act(()=>requestBlockMenu(editor));
 await screen.findByRole('menu',{name:'块操作'});
 fireEvent.click(screen.getByRole('menuitem',{name:'创建副本'}));
 await waitFor(()=>expect(latest.blocks).toHaveLength(3));
 expect(latest.blocks[1].content).toEqual(latest.blocks[0].content);
 expect(container.querySelectorAll('[data-orbis-selected="true"]')).toHaveLength(1);
 act(()=>{editor.commands.setTextSelection(1);editor.commands.setHeading({level:2});});
 await screen.findByRole('button',{name:'块操作：标题'});
 act(()=>requestBlockMenu(editor));
 const opened=await screen.findByRole('menu',{name:'块操作'});
 expect(opened).toHaveTextContent('标题');
 act(()=>{editor.commands.setParagraph();});
 await waitFor(()=>expect(screen.getByRole('menu',{name:'块操作'})).toHaveTextContent('段落'));
});

it('keeps the block menu open during embedded scrolling but closes it on document scrolling', async () => {
 const {container}=render(<><TiptapEditor blocks={blocks} onChange={()=>{}}/><div data-orbis-embedded-editor><div data-testid="embedded-scroll"/></div></>);
 await screen.findByText('First');await menu(container);
 fireEvent.scroll(screen.getByTestId('embedded-scroll'));
 expect(screen.getByRole('menu',{name:'块操作'})).toBeVisible();
 fireEvent.scroll(document);
 expect(screen.queryByRole('menu',{name:'块操作'})).toBeNull();
});

it('reports a failed complete-block copy request once without losing the original body', async () => {
 const {apiRequest}=await import('../../../shared/api/api-client');
 const {registerBlockActionReader}=await import('./blocks/block-action-read');
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({code:'READ_FAILED',message:'服务端拒绝读取此块',request_id:'copy',data:null}),{status:503,headers:{'Content-Type':'application/json'}})));
 const {container}=render(<TiptapEditor blocks={blocks} onChange={()=>{}}/>);
 await screen.findByText('First');
 const editor=(container.querySelector('.ProseMirror') as HTMLElement&{editor:import('@tiptap/core').Editor}).editor;
 const unregister=registerBlockActionReader(editor,{needsRead:()=>true,ensure:async()=>{await apiRequest('/v1/test/block');}});
 await menu(container);
 fireEvent.click(screen.getByRole('menuitem',{name:'复制块'}));
 await waitFor(()=>expect(notify).toHaveBeenCalledExactlyOnceWith({title:'服务端拒绝读取此块',tone:'danger'}));
 expect(editor.state.doc.textContent).toBe('FirstSecond');
 unregister();
});

it('does not add progress or duplicate error toasts when complete-reading and keyboard copy share a request', async () => {
 const {apiRequest}=await import('../../../shared/api/api-client');
 let finish!:(response:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
 const {container}=render(<TiptapEditor blocks={blocks} hasMoreContent ensureComplete={async()=>{await apiRequest('/v1/test/content');}} onChange={()=>{}}/>);
 await screen.findByText('First');
 const editable=container.querySelector('.ProseMirror')!;
 fireEvent.keyDown(editable,{ctrlKey:true,key:'a'});
 fireEvent.keyDown(editable,{ctrlKey:true,key:'c'});
 expect(notify).not.toHaveBeenCalled();
 await act(async()=>{finish(new Response(JSON.stringify({code:'READ_FAILED',message:'后续正文读取失败',request_id:'copy-all',data:null}),{status:503,headers:{'Content-Type':'application/json'}}));});
 await waitFor(()=>expect(notify).toHaveBeenCalledExactlyOnceWith({title:'后续正文读取失败',tone:'danger'}));
 expect(editable.textContent).toBe('FirstSecond');
});

it.each(['menu','keyboard'])('ignores a delayed clipboard read failure after leaving the editor (%s)',async mode=>{
 const {registerBlockActionReader}=await import('./blocks/block-action-read');
 let fail!:(error:Error)=>void;
 const reading=new Promise<void>((_resolve,reject)=>{fail=reject;});
 const view=render(<TiptapEditor blocks={blocks} hasMoreContent ensureComplete={()=>reading} onChange={()=>{}}/>);
 await screen.findByText('First');
 const editable=view.container.querySelector('.ProseMirror')!;
 const editor=(editable as HTMLElement&{editor:import('@tiptap/core').Editor}).editor;
 if(mode==='menu') {
  registerBlockActionReader(editor,{needsRead:()=>true,ensure:()=>reading});
  await menu(view.container);fireEvent.click(screen.getByRole('menuitem',{name:'复制块'}));
 } else {fireEvent.keyDown(editable,{ctrlKey:true,key:'a'});fireEvent.keyDown(editable,{ctrlKey:true,key:'c'});}
 view.unmount();
 await act(async()=>{fail(new Error('上一份文档的读取失败'));});
 expect(notify).not.toHaveBeenCalled();
});

it.each(['editor whitespace', 'page gutter', 'release position', 'invalid position'])('moves a block when dropped through %s', async area => {
 const {container}=render(<div className="document-scroll-region"><TiptapEditor blocks={blocks} onChange={()=>{}}/></div>);
 await screen.findByText('First');
 const dom=container.querySelector<HTMLElement>('.ProseMirror')!;
 const editor=(dom as HTMLElement & {editor:import('@tiptap/core').Editor}).editor;
 Object.defineProperty(dom,'offsetParent',{configurable:true,value:dom.parentElement});
 const paragraphs=dom.querySelectorAll('p');
 vi.spyOn(dom,'getBoundingClientRect').mockReturnValue(new DOMRect(100,100,500,200));
 paragraphs.forEach((paragraph,index)=>vi.spyOn(paragraph,'getBoundingClientRect').mockReturnValue(new DOMRect(100,100+index*100,500,40)));
 vi.spyOn(editor.view,'posAtCoords').mockImplementation(({top})=>top>300?null:{pos:editor.state.doc.firstChild!.nodeSize+1,inside:editor.state.doc.firstChild!.nodeSize});
 fireEvent.pointerMove(paragraphs[0],{clientX:110,clientY:110});
 const handle=await screen.findByRole('button',{name:'块操作：段落'});
 const values=new Map<string,string>();
 const dataTransfer={setData:(type:string,value:string)=>values.set(type,value),getData:(type:string)=>values.get(type)??'',effectAllowed:'',dropEffect:'',setDragImage:vi.fn()};
 fireEvent.dragStart(handle,{dataTransfer});
 expect(dataTransfer.setDragImage).toHaveBeenCalledWith(document.querySelector('.orbis-block-drag-preview'),16,16);
 expect(document.querySelector('.block-drag-preview-text')).toHaveTextContent('First');
 const target=area==='editor whitespace'?dom:container.querySelector('.document-scroll-region')!;
 for(const type of ['dragover','drop']) {
  const y=area==='invalid position'&&type==='drop'?400:area==='release position'&&type==='dragover'?201:239;
  const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:80,clientY:y});
  Object.defineProperty(event,'dataTransfer',{value:dataTransfer});
  fireEvent(target,event);
 }
 expect([...dom.querySelectorAll(':scope > p')].map(node=>node.textContent)).toEqual(area==='invalid position'?['First','Second']:['Second','First']);
 expect(document.querySelector('.orbis-block-drop')).toBeNull();
 expect(document.querySelector('.orbis-block-drag-preview')).toBeNull();
 expect(container.querySelector('.is-block-dragging')).toBeNull();
 if(area!=='invalid position'){
  fireEvent.click(screen.getByRole('button',{name:'撤销'}));
  expect([...dom.querySelectorAll(':scope > p')].map(node=>node.textContent)).toEqual(['First','Second']);
 }
});

it.each([20,36])('centers the handle on the first text line at %ipx, independent of block height',async textHeight=>{
 const {container}=render(<TiptapEditor blocks={blocks} onChange={()=>{}}/>);
 const paragraph=await screen.findByText('First');
 vi.spyOn(paragraph,'getBoundingClientRect').mockReturnValue(new DOMRect(100,100,500,180));
 vi.spyOn(Range.prototype,'getClientRects').mockReturnValue([new DOMRect(100,110,10,textHeight)] as unknown as DOMRectList);
 fireEvent.pointerMove(paragraph,{clientX:110,clientY:115});
 await screen.findByRole('button',{name:'块操作：段落'});
 const controls=container.querySelector<HTMLElement>('.orbis-block-controls')!;
 vi.spyOn(controls,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,15,15));
 fireEvent.pointerMove(paragraph,{clientX:111,clientY:115});
 await waitFor(()=>expect(controls.style.top).toBe(`${110+textHeight/2-7.5}px`));
 expect(controls.style.left).toBe('69px');
});

it('navigates from the outline to the heading and repeats navigation without changing content',async()=>{
 const {EditorLayout,EditorOutlineStore}=await import('./EditorLayout');
 const heading:NoteBlocksV2={...blocks,blocks:[{...blocks.blocks[0],type:'heading',props:{level:2}},blocks.blocks[1]]};
 const store=new EditorOutlineStore();store.update(heading);
 const scroll=vi.fn();
 const load=vi.fn(async()=>{});
 const {container}=render(<EditorLayout outlineStore={store} loadOutlineContent={load}><TiptapEditor noteId="outline-document" blocks={heading} onChange={()=>{}}/></EditorLayout>);
 const node=container.querySelector('.ProseMirror h2')!;
 Object.defineProperty(node,'scrollIntoView',{configurable:true,value:scroll});
 const editor=(container.querySelector('.ProseMirror') as HTMLElement & {editor:import('@tiptap/core').Editor}).editor;
 const before=editor.state.doc;
 const link=screen.getByRole('button',{name:'First'});
 fireEvent.click(link);
 await waitFor(()=>expect(scroll).toHaveBeenCalledTimes(1));
 expect(node).toHaveAttribute('data-orbis-target','true');
 fireEvent.click(link);
 await waitFor(()=>expect(scroll).toHaveBeenCalledTimes(2));
 expect(editor.state.doc).toBe(before);
 expect(load).not.toHaveBeenCalled();
});

it('loads a heading payload even when its empty placeholder is already in the editor',async()=>{
 const {EditorLayout,EditorOutlineStore}=await import('./EditorLayout');
 const heading:NoteBlocksV2={...blocks,blocks:[{...blocks.blocks[0],type:'heading',props:{level:2},content:[]},blocks.blocks[1]]};
 const store=new EditorOutlineStore();
 const unread={id:'b0',parent_id:null,child_count:0,has_children:false,children_loaded:true,payload_loaded:false,payload_bytes:100,cursor:null,loaded_count:0};
 store.setSourceRoots(heading.blocks);
 store.setReadState(new Map([['b0',unread]]));
 store.setRemote([{id:'b0',level:2,text:'Loaded heading',root_index:0}],2);
 store.update(heading);
 const scroll=vi.fn();
 let editor:import('@tiptap/core').Editor;
 const load=vi.fn(async()=>{
  editor.commands.insertContentAt({from:1,to:1},'Loaded heading');
  store.setReadState(new Map([['b0',{...unread,payload_loaded:true}]]));
 });
 const {container}=render(<EditorLayout outlineStore={store} loadOutlineContent={load}><TiptapEditor noteId="outline-document" blocks={heading} onChange={()=>{}}/></EditorLayout>);
 editor=(container.querySelector('.ProseMirror') as HTMLElement & {editor:import('@tiptap/core').Editor}).editor;
 const node=container.querySelector('.ProseMirror h2')!;
 expect(node).toHaveAttribute('data-orbis-block-id','b0');
 expect(node).toHaveTextContent('');
 Object.defineProperty(node,'scrollIntoView',{configurable:true,value:scroll});
 fireEvent.click(screen.getByRole('button',{name:'Loaded heading'}));
 await waitFor(()=>expect(scroll).toHaveBeenCalledTimes(1));
 expect(load).toHaveBeenCalledTimes(1);
 expect(node).toHaveTextContent('Loaded heading');
 expect(node).toHaveAttribute('data-orbis-target','true');
 fireEvent.click(screen.getByRole('button',{name:'Loaded heading'}));
 await waitFor(()=>expect(scroll).toHaveBeenCalledTimes(2));
 expect(load).toHaveBeenCalledTimes(1);
});

it('loads an unread heading before navigating from the outline',async()=>{
 const {EditorLayout,EditorOutlineStore}=await import('./EditorLayout');
 const store=new EditorOutlineStore();store.setRemote([{id:'later',level:2,text:'Later',root_index:2}],0);
 const scroll=vi.fn();
 let editor:import('@tiptap/core').Editor;
 const load=vi.fn(async()=>{
  editor.commands.insertContentAt(editor.state.doc.content.size,{type:'heading',attrs:{level:2,orbisId:'later'},content:[{type:'text',text:'Later'}]});
  const node=editor.view.dom.querySelector('[data-orbis-block-id="later"]')!;
  Object.defineProperty(node,'scrollIntoView',{configurable:true,value:scroll});
 });
 const {container}=render(<EditorLayout outlineStore={store} loadOutlineContent={load}><TiptapEditor noteId="outline-document" blocks={blocks} onChange={()=>{}}/></EditorLayout>);
 editor=(container.querySelector('.ProseMirror') as HTMLElement & {editor:import('@tiptap/core').Editor}).editor;
 fireEvent.click(screen.getByRole('button',{name:'Later'}));
 await waitFor(()=>expect(scroll).toHaveBeenCalledTimes(1));
 expect(load).toHaveBeenCalledTimes(1);
});
