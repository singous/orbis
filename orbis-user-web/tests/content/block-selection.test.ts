import { Editor } from '@tiptap/core';
import { afterEach, expect, it } from 'vitest';
import { tiptapExtensions } from '../../src/features/notes/tiptap-extensions';
import { toTiptapDocument } from '../../src/features/notes/tiptap-model';
import { OrbisBlockSelection, blockSelectionKey, selectBlock, clearBlockSelection, setBlockTarget } from '../../src/features/notes/blocks/block-selection';
import { locateEditorBlocks, executeBlockCommand } from '../../src/features/notes/blocks/block-commands';

let editor: Editor;
afterEach(() => editor?.destroy());
function setup() {
 editor = new Editor({ extensions: [...tiptapExtensions, OrbisBlockSelection], content: toTiptapDocument({schema_version:2,editor:'blocknote',blocks:['a','b','c'].map(id=>({id,type:'paragraph',props:{},content:[{type:'text',text:id}],children:[]}))}) });
 return editor;
}
it('selects a range and toggles one block without changing content',()=>{
 setup(); const original=editor.state.doc;
 selectBlock(editor,'a'); selectBlock(editor,'c',{shift:true});
 expect(blockSelectionKey.getState(editor.state)?.ids).toEqual(['a','b','c']);
 selectBlock(editor,'b',{toggle:true});
 expect(blockSelectionKey.getState(editor.state)?.ids).toEqual(['a','c']);
 expect(editor.state.doc).toBe(original);
 clearBlockSelection(editor);
 expect(blockSelectionKey.getState(editor.state)?.ids).toEqual([]);
});
it('marks selected blocks in the actual editor DOM and removes vanished IDs',()=>{
 setup();selectBlock(editor,'b');
 expect(editor.view.dom.querySelector('[data-orbis-selected="true"]')?.textContent).toBe('b');
 editor.commands.setContent({type:'doc',content:[{type:'paragraph',attrs:{orbisId:'a'},content:[{type:'text',text:'a'}]}]},false);
 expect(blockSelectionKey.getState(editor.state)?.ids).toEqual([]);
});
it('leaves text input and composition alone while allowing Escape from block mode',()=>{
 setup();selectBlock(editor,'b');
 const composition=new KeyboardEvent('keydown',{key:'Backspace',isComposing:true,bubbles:true,cancelable:true});
 editor.view.dom.dispatchEvent(composition);
 expect(editor.state.doc.textContent).toBe('abc');
 editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 expect(blockSelectionKey.getState(editor.state)?.ids).toEqual([]);
});
it('shrinks a keyboard range back toward its anchor before extending the other way',()=>{
 setup();selectBlock(editor,'b');
 const press=(key:string)=>editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key,shiftKey:true,bubbles:true,cancelable:true}));
 press('ArrowDown');expect(blockSelectionKey.getState(editor.state)?.ids).toEqual(['b','c']);
 press('ArrowUp');expect(blockSelectionKey.getState(editor.state)?.ids).toEqual(['b']);
 press('ArrowUp');expect(blockSelectionKey.getState(editor.state)?.ids).toEqual(['a','b']);
});

it('maps block decorations through typing, splitting, grouping and undo without losing identity',()=>{
 setup();
 const verify=()=>{
  const ids=Array.from(editor.view.dom.querySelectorAll('[data-orbis-block-id]'),node=>node.getAttribute('data-orbis-block-id'));
  expect(ids).toEqual(locateEditorBlocks(editor.state.doc).map(entry=>entry.id));
  expect(new Set(ids).size).toBe(ids.length);
 };
 selectBlock(editor,'c');setBlockTarget(editor,'b');
 editor.commands.insertContentAt(1,'Long prefix ');
 verify();
 expect(editor.view.dom.querySelector('[data-orbis-selected="true"]')?.textContent).toBe('c');
 expect(editor.view.dom.querySelector('[data-orbis-target="true"]')?.textContent).toBe('b');
 editor.commands.setTextSelection(5);editor.commands.splitBlock();verify();
 expect(executeBlockCommand(editor,['b','c'],{type:'group'}).ok).toBe(true);verify();
 editor.commands.undo();verify();
 editor.commands.setContent({type:'doc',content:[{type:'paragraph',attrs:{orbisId:'fresh'},content:[{type:'text',text:'Fresh'}]}]},false);verify();
 expect(editor.view.dom.querySelector('[data-orbis-selected="true"]')).toBeNull();
});
