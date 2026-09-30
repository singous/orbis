import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { tiptapExtensions } from '../../src/features/notes/tiptap-extensions';
import { fromTiptapDocument, toTiptapDocument } from '../../src/features/notes/tiptap-model';
import { OrbisBlockSelection, setBlockSelection } from '../../src/features/notes/blocks/block-selection';
import { BLOCK_CLIPBOARD_MIME, copyBlocks, installBlockClipboard, parseBlockClipboard, pasteBlocks, serializeBlockClipboard } from '../../src/features/notes/blocks/block-clipboard';
import type { OrbisBlock } from '../../src/features/notes/block-model';
const editors: Editor[] = [];
const p = (id: string, children: OrbisBlock[] = []): OrbisBlock => ({ id, type: 'paragraph', props: {}, content: id, children });
function open(blocks = [p('a'), p('b')]) { const e = new Editor({ extensions: [...tiptapExtensions, OrbisBlockSelection], content: toTiptapDocument({schema_version:2,editor:'blocknote',blocks}) }); document.body.appendChild(e.view.dom); editors.push(e); return e; }
afterEach(() => { editors.splice(0).forEach(e=>{e.view.dom.remove();e.destroy();}); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function event(e: Editor, type: string, data = new Map<string,string>()) {
 const ev = new Event(type, { bubbles:true,cancelable:true }); Object.defineProperty(ev,'clipboardData',{ value:{ getData:(k:string)=>data.get(k)||'', setData:(k:string,v:string)=>data.set(k,v) } }); e.view.dom.dispatchEvent(ev); return {ev,data};
}
it('excludes internal metadata while retaining authored mixed trees',()=>{
 const e=open([{...p('a',[{...p('file'),type:'file',props:{url:'orbis-file:019abcde-0000-0000-0000-000000000000',name:'attachment'}}]),props:{title:'Safe',private_token:'secret'}}]);
 const value=serializeBlockClipboard(e,['a','file']);
 expect(value.structured).not.toContain('secret');expect(value.html).not.toContain('orbisOriginal');
 expect(parseBlockClipboard(value.structured)?.blocks).toHaveLength(1);
});
it.each([false,true])('rejects lossy signed resource copy (cut=%s) before writing or deleting',async(cut)=>{
 const e=open([{...p('signed'),type:'image',props:{url:'https://example.com/image.png?token=abc'}},p('b')]);
 const original=e.state.doc;const write=vi.fn(()=>true);Object.defineProperty(document,'execCommand',{configurable:true,value:write});
 const result=await copyBlocks(e,['signed'],cut);
 expect(result.ok).toBe(false);expect(result.message).toContain('无法完整保留');expect(e.state.doc).toBe(original);expect(write).not.toHaveBeenCalled();
});
it('rejects native cut with unsafe authored link and preserves the original document',()=>{
 const e=open([{...p('a'),content:[{type:'link',href:'javascript:alert(1)',content:'Authored link'}]}]);
 const result=vi.fn();installBlockClipboard(e,result);setBlockSelection(e,['a']);const original=e.state.doc;
 const {data,ev}=event(e,'cut');expect(ev.defaultPrevented).toBe(true);expect(data.size).toBe(0);expect(e.state.doc).toBe(original);expect(result).toHaveBeenCalledWith(expect.objectContaining({ok:false,message:expect.stringContaining('无法完整保留')}));
});
it.each([
 {props:{customAuthorProperty:'preserve me'}},
 {content:[{type:'text',text:'Styled text',styles:{textColor:'rgb(10, 20, 30)'}}]},
])('rejects unsupported authored properties or styles instead of stripping them',async(fields)=>{
 const e=open([{...p('a'),...fields} as OrbisBlock]);const original=e.state.doc;
 const result=await copyBlocks(e,['a'],true);expect(result.ok).toBe(false);expect(result.message).toContain('无法完整保留');expect(e.state.doc).toBe(original);
});
it('rejects invalid content, unsupported types and excessive nesting',()=>{
 const wrap=(blocks:unknown)=>JSON.stringify({version:1,blocks});
 expect(parseBlockClipboard(wrap([{...p('a'),content:[{type:'text',text:{evil:1}}]}]))).toBeNull();
 expect(parseBlockClipboard(wrap([{...p('a'),type:'evil'}]))).toBeNull();
 let b=p('deep');for(let i=0;i<70;i++)b=p(String(i),[b]); expect(parseBlockClipboard(wrap([b]))).toBeNull();
});
it('leaves ordinary text events intact and copies selected blocks natively',()=>{
 const e=open();installBlockClipboard(e,()=>{});const untouched=event(e,'copy');expect(untouched.ev.defaultPrevented).toBe(false);
 setBlockSelection(e,['a']);const copied=event(e,'copy');expect(copied.ev.defaultPrevented).toBe(true);expect(copied.data.has(BLOCK_CLIPBOARD_MIME)).toBe(true);
});
it('never deletes when clipboard writing fails',async()=>{
 const e=open();Object.defineProperty(document,'execCommand',{configurable:true,value:vi.fn(()=>false)});
 const result=await copyBlocks(e,['a'],true);expect(result.ok).toBe(false);expect(fromTiptapDocument(e.state.doc).blocks.map(b=>b.id)).toEqual(['a','b']);
});
it('preserves controlled cut IDs once, regenerates cross editor IDs and prevents undo collisions',()=>{
 const e=open([p('a',[p('child')]),p('b')]);installBlockClipboard(e,()=>{});setBlockSelection(e,['a']);const {data}=event(e,'cut');expect(fromTiptapDocument(e.state.doc).blocks.map(b=>b.id)).toEqual(['b']);
 setBlockSelection(e,['b']);event(e,'paste',data);expect(fromTiptapDocument(e.state.doc).blocks.map(b=>b.id)).toEqual(['b','a']);
 event(e,'paste',data);const ids=fromTiptapDocument(e.state.doc).blocks.map(b=>b.id);expect(new Set(ids).size).toBe(ids.length);
 const other=open([p('target')]);installBlockClipboard(other,()=>{});setBlockSelection(other,['target']);event(other,'paste',data);expect(fromTiptapDocument(other.state.doc).blocks[1].id).not.toBe('a');
});

it('falls back to native copy on HTTP and includes HTML structured fallback',async()=>{
 const e=open();installBlockClipboard(e,()=>{});let copied:Map<string,string>|undefined;
 Object.defineProperty(document,'execCommand',{configurable:true,value:vi.fn(()=>{copied=event(e,'copy').data;return true;})});
 expect((await copyBlocks(e,['a'],true)).ok).toBe(true);
 const html=copied!.get('text/html')!;expect(html).toContain('data-orbis-block-clipboard');
 setBlockSelection(e,['b']);event(e,'paste',new Map([['text/html',html]]));expect(fromTiptapDocument(e.state.doc).blocks.map(b=>b.id)).toEqual(['b','a']);
});
it('clones IDs if cut was undone before paste',()=>{
 const e=open([p('a',[p('child')]),p('b')]);installBlockClipboard(e,()=>{});setBlockSelection(e,['a']);const {data}=event(e,'cut');e.commands.undo();
 setBlockSelection(e,['b']);event(e,'paste',data);
 const blocks=fromTiptapDocument(e.state.doc).blocks;expect(blocks).toHaveLength(3);expect(blocks[2].id).not.toBe('a');expect(blocks[2].children[0].id).not.toBe('child');
});
it('rejects malformed recognized clipboard without native HTML fallback',()=>{
 const e=open();installBlockClipboard(e,()=>{});const original=e.state.doc;
 const {ev}=event(e,'paste',new Map([[BLOCK_CLIPBOARD_MIME,'{"version":1,"blocks":[{}]}'],['text/html','<p>Injected fallback</p>']]));
 expect(ev.defaultPrevented).toBe(true);expect(e.state.doc).toBe(original);
});
it('pastes ordinary external text atomically after a block selection',()=>{
 const e=open();installBlockClipboard(e,()=>{});setBlockSelection(e,['a']);event(e,'paste',new Map([['text/plain','Outside text']]));
 expect(fromTiptapDocument(e.state.doc).blocks[1].content).toEqual('Outside text');e.commands.undo();expect(fromTiptapDocument(e.state.doc).blocks.map(b=>b.id)).toEqual(['a','b']);
});

it('retains table cell styles, callout properties and managed attachment references',()=>{
 const attachment={...p('file'),type:'file',props:{url:'orbis-file:019abcde-0000-0000-0000-000000000000',name:'Report.pdf'}};
 const table:OrbisBlock={id:'table',type:'table',props:{},content:{type:'tableContent',headerRows:1,rows:[{cells:[{type:'tableCell',props:{colspan:1,backgroundColor:'#112233'},content:[{type:'text',text:'Cell',styles:{bold:true}}]}]}]},children:[]};
 const source=open([{...p('callout',[attachment,table]),type:'callout',props:{title:'Review',tone:'warning'}}]);
 const data=serializeBlockClipboard(source,['callout']);const blocks=parseBlockClipboard(data.structured)!.blocks;
 expect(blocks[0].props).toEqual({title:'Review',tone:'warning'});expect(blocks[0].children[0].props.url).toBe(attachment.props.url);
 const destination=open([p('target')]);installBlockClipboard(destination,()=>{});setBlockSelection(destination,['target']);event(destination,'paste',new Map([['text/html',data.html]]));
 const result=fromTiptapDocument(destination.state.doc).blocks[1];expect(result.id).not.toBe('callout');expect(result.children[1].content).toEqual(table.content);expect(result.children[0].props).toEqual(attachment.props);
});
it('rejects invalid authored table spans before native cut deletes anything',()=>{
 const table:OrbisBlock={id:'table',type:'table',props:{},content:{type:'tableContent',rows:[{cells:[{type:'tableCell',props:{colspan:101},content:'Wide cell'}]}]},children:[]};
 const e=open([table,p('b')]);const result=vi.fn();installBlockClipboard(e,result);setBlockSelection(e,['table']);const original=e.state.doc;
 const {data}=event(e,'cut');expect(data.size).toBe(0);expect(e.state.doc).toBe(original);expect(result).toHaveBeenCalledWith(expect.objectContaining({ok:false,message:expect.stringContaining('无法完整保留')}));
});
it('copies and cuts API-normalized empty inline styles without treating them as data loss',async()=>{
 const e=open([{...p('a'),content:[{type:'text',text:'Alpha',styles:{}}]},p('b')]);
 Object.defineProperty(document,'execCommand',{configurable:true,value:vi.fn(()=>{event(e,'copy');return true;})});
 expect((await copyBlocks(e,['a'])).ok).toBe(true);
 expect((await copyBlocks(e,['a'],true)).ok).toBe(true);
 expect(fromTiptapDocument(e.state.doc).blocks.map(b=>b.id)).toEqual(['b']);
});
it('preserves legacy table cells with omitted optional props and empty styles',()=>{
 const table:OrbisBlock={id:'table',type:'table',props:{},content:{type:'tableContent',rows:[{cells:[{type:'tableCell',content:[{type:'text',text:'Cell',styles:{}}]},{type:'tableCell'}]}]},children:[]};
 const e=open([table,p('b')]);const result=vi.fn();installBlockClipboard(e,result);setBlockSelection(e,['table']);const {data}=event(e,'cut');
 expect(result).toHaveBeenCalledWith(expect.objectContaining({ok:true}));expect(data.has(BLOCK_CLIPBOARD_MIME)).toBe(true);
 expect(fromTiptapDocument(e.state.doc).blocks.map(b=>b.id)).toEqual(['b']);
});
it('copies a large valid authored document without truncation',()=>{
 const blocks:OrbisBlock[]=Array.from({length:450},(_,i)=>({...p(`paragraph-${i}`),content:Array.from({length:30},(_,j)=>({type:'text' as const,text:`${i}:${j} ${'x'.repeat(180)}`,styles:j%2?{bold:true as const}:{}}))}));
 const e=open(blocks);const serialized=serializeBlockClipboard(e,blocks.map(b=>b.id));
 expect(serialized.structured.length).toBeGreaterThan(2_000_000);
 const parsed=parseBlockClipboard(serialized.structured)!;expect(parsed.blocks).toHaveLength(450);
 const texts=(values:OrbisBlock[])=>values.map(block=>Array.isArray(block.content)?block.content.map(item=>item.type==='text'?item.text:''):block.content);
 expect(texts(parsed.blocks)).toEqual(texts(blocks));
 expect(serialized.text).toContain('449:29');
});
it('pastes rich internal blocks through the clipboard read API',async()=>{
 const source=open([p('source',[p('child')])]);const serialized=serializeBlockClipboard(source,['source']);
 vi.stubGlobal('navigator',{platform:'',userAgent:'',maxTouchPoints:0,clipboard:{read:vi.fn().mockResolvedValue([{types:['text/html'],getType:async()=>({text:async()=>serialized.html})}])}});
 const target=open();const result=await pasteBlocks(target,['a']);expect(result.ok).toBe(true);
 const blocks=fromTiptapDocument(target.state.doc).blocks;expect(blocks[1].id).not.toBe('source');expect(blocks[1].children[0].content).toBe('child');
});
it('pastes external plain text and rich HTML from explicit clipboard reading',async()=>{
 const target=open();
 vi.stubGlobal('navigator',{platform:'',userAgent:'',maxTouchPoints:0,clipboard:{read:vi.fn().mockResolvedValue([{types:['text/plain'],getType:async()=>({text:async()=> 'Plain clipboard'})}])}});
 expect((await pasteBlocks(target,['a'])).ok).toBe(true);expect(fromTiptapDocument(target.state.doc).blocks[1].content).toBe('Plain clipboard');
 vi.stubGlobal('navigator',{platform:'',userAgent:'',maxTouchPoints:0,clipboard:{read:vi.fn().mockResolvedValue([{types:['text/html'],getType:async()=>({text:async()=> '<p><strong>Rich clipboard</strong></p>'})}])}});
 expect((await pasteBlocks(target,['b'])).ok).toBe(true);expect(target.getHTML()).toContain('<strong>Rich clipboard</strong>');
});
it.each([undefined,vi.fn().mockRejectedValue(new DOMException('Denied','NotAllowedError'))])('does not mutate when clipboard reading is unavailable or denied',async(read)=>{
 vi.stubGlobal('navigator',{platform:'',userAgent:'',maxTouchPoints:0,clipboard:read?{read}:undefined});const target=open();const original=target.state.doc;
 const result=await pasteBlocks(target,['a']);expect(result.ok).toBe(false);expect(result.message).toContain('长按');expect(result.message).toContain('Ctrl');expect(target.state.doc).toBe(original);
});
it('rejects malformed custom data from explicit clipboard reading',async()=>{
 vi.stubGlobal('navigator',{platform:'',userAgent:'',maxTouchPoints:0,clipboard:{read:vi.fn().mockResolvedValue([{types:[BLOCK_CLIPBOARD_MIME],getType:async()=>({text:async()=> '{invalid'})}])}});
 const target=open();const original=target.state.doc;expect((await pasteBlocks(target,['a'])).ok).toBe(false);expect(target.state.doc).toBe(original);
});
it('shares controlled native cut identity validation with explicit paste',async()=>{
 const e=open();installBlockClipboard(e,()=>{});setBlockSelection(e,['a']);const {data}=event(e,'cut');
 vi.stubGlobal('navigator',{platform:'',userAgent:'',maxTouchPoints:0,clipboard:{read:vi.fn().mockResolvedValue([{types:[BLOCK_CLIPBOARD_MIME],getType:async()=>({text:async()=>data.get(BLOCK_CLIPBOARD_MIME)!})}])}});
 expect((await pasteBlocks(e,['b'])).ok).toBe(true);expect(fromTiptapDocument(e.state.doc).blocks.map(b=>b.id)).toEqual(['b','a']);
});
it('does not paste after the document changes while clipboard permission is pending',async()=>{
 const e=open();let resolve!:(value:unknown[])=>void;
 vi.stubGlobal('navigator',{platform:'',userAgent:'',maxTouchPoints:0,clipboard:{read:vi.fn(()=>new Promise(r=>{resolve=r;}))}});
 const pending=pasteBlocks(e,['a']);e.commands.insertContent('Changed');const changed=e.state.doc;
 resolve([{types:['text/plain'],getType:async()=>({text:async()=> 'Late clipboard'})}]);
 expect((await pending).ok).toBe(false);expect(e.state.doc).toBe(changed);
});
it.each([
 [{type:'heading',attrs:{level:2},content:[{type:'text',text:'Heading'}]},{type:'paragraph',content:[{type:'text',text:'Body'}]}],
 [{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'List item'}]}]}]}],
 [{type:'paragraph',content:[{type:'text',text:'First paragraph'}]},{type:'paragraph',content:[{type:'text',text:'Second paragraph'}]}],
].map(content=>[content]))('refuses cut of unsupported live table cell block structure before flattening',async(content)=>{
 const e=open();e.commands.setContent({type:'doc',content:[{type:'table',attrs:{orbisId:'live-table'},content:[{type:'tableRow',content:[{type:'tableCell',content}]}]}]});
 const original=e.state.doc;const result=await copyBlocks(e,['live-table'],true);
 expect(result.ok).toBe(false);expect(result.message).toContain('表格单元格');expect(e.state.doc).toBe(original);
 expect(()=>serializeBlockClipboard(e,['live-table'])).toThrow('表格单元格');
});
it('preserves supported internal document links through real Editor copy and paste',()=>{
 const href='/documents/019abcde-0000-0000-0000-000000000000#section_1';
 const source=open([{...p('a'),content:[{type:'link',href,content:[{type:'text',text:'Internal document'}]}]}]);
 const serialized=serializeBlockClipboard(source,['a']);const target=open();installBlockClipboard(target,()=>{});setBlockSelection(target,['b']);
 event(target,'paste',new Map([[BLOCK_CLIPBOARD_MIME,serialized.structured]]));
 expect(fromTiptapDocument(target.state.doc).blocks[2].content).toEqual([{type:'link',href,content:[{type:'text',text:'Internal document'}]}]);
});
it.each(['/documents/../private','/documents/019abcde-0000-0000-0000-000000000000/../private','/other/path','javascript:alert(1)'])('rejects unsupported relative or unsafe links: %s',(href)=>{
 const e=open([{...p('a'),content:[{type:'link',href,content:'Link'}]}]);expect(()=>serializeBlockClipboard(e,['a'])).toThrow('无法完整保留');
});
it('does not accept document routes as media URLs',()=>{
 const e=open([{...p('a'),type:'image',props:{url:'/documents/019abcde-0000-0000-0000-000000000000'}}]);expect(()=>serializeBlockClipboard(e,['a'])).toThrow('无法完整保留');
});
