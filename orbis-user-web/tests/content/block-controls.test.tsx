import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Profiler } from 'react';
import * as tree from '../../src/features/notes/blocks/block-tree';
import { requestBlockMenu } from '../../src/features/notes/blocks/BlockControls';
import { TiptapEditor } from '../../src/features/notes/TiptapEditor';
import type { NoteBlocksV2 } from '../../src/features/notes/block-model';
const blocks:NoteBlocksV2={schema_version:2,editor:'blocknote',blocks:['First','Second'].map((text,index)=>({id:`b${index}`,type:'paragraph',props:{},content:[{type:'text',text}],children:[]}))};
afterEach(()=>{cleanup();vi.restoreAllMocks();});
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
 const {selectBlock}=await import('../../src/features/notes/blocks/block-selection');
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
