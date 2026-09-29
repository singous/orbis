import type { Editor } from '@tiptap/core';
import { DOMParser as ProseMirrorDOMParser, DOMSerializer } from '@tiptap/pm/model';
import { safeContentUrl } from '../../content/ContentRenderer';
import { documentBlockDefinition } from '../../content/document-components';
import { parseFileReference } from '../../files/managed-files';
import { canonicalJSON, extractPlainTextV2, newBlockId, type OrbisBlock, type OrbisInline, type OrbisTableCell } from '../block-model';
import { clipboardProps } from '../tiptap-clipboard';
import { fromTiptapDocument, toTiptapDocument } from '../tiptap-model';
import { executeBlockCommand, locateEditorBlocks } from './block-commands';
import { blockSelectionKey, isEmbeddedInput } from './block-selection';
import { indexBlocks } from './block-tree';

export const BLOCK_CLIPBOARD_MIME = 'application/x-orbis-blocks+json';
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_NODES = 100_000;
const MAX_DEPTH = 40;
const BASIC_TYPES = new Set(['paragraph','heading','bulletListItem','numberedListItem','checkListItem','toggleListItem','quote','codeBlock','divider','table','image','video','audio','file']);
export type BlockClipboardResult = { ok: boolean; selectedIds?: string[]; message?: string };
type Payload = { version: 1; blocks: OrbisBlock[]; cutToken?: string };
type Serialized = { structured: string; html: string; text: string; payload: Payload };
const cutSessions = new WeakMap<Editor, { token: string; blocks: string }>();
// These fields are editor/session metadata, never authored document content.
const INTERNAL_METADATA = new Set(['orbisOriginal', 'orbisSignature', 'orbisCellOriginal', 'orbisOwn', 'private_token', 'access_token', 'accessToken']);
class ClipboardSerializationError extends Error {}
const LOSSY_COPY_MESSAGE = '无法完整保留选区中的资源、链接或格式，已取消复制/剪切，原内容已保留。请先将临时签名链接替换为文件引用或稳定链接，并检查不支持的内容。';
function authoredSemanticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(authoredSemanticValue);
  if (!record(value)) return value;
  const normalized = Object.fromEntries(Object.entries(value).filter(([key]) => !INTERNAL_METADATA.has(key)).map(([key, item]) => [key, authoredSemanticValue(item)]));
  // API and legacy shapes may omit these optional fields or emit empty defaults.
  // Normalize only contract-defined defaults, retaining all nonempty author data.
  if (value.type === 'text' && record(normalized.styles) && Object.keys(normalized.styles).length === 0) delete normalized.styles;
  if (value.type === 'tableCell') {
    if (normalized.props === undefined) normalized.props = {};
    if (normalized.content === undefined) normalized.content = [];
  }
  if (typeof value.type === 'string' && (BASIC_TYPES.has(value.type) || documentBlockDefinition(value.type))) {
    if (normalized.props === undefined) normalized.props = {};
    if (normalized.children === undefined) normalized.children = [];
    if (normalized.content === undefined) normalized.content = [];
  }
  return normalized;
}
function copyFailure(error: unknown, fallback: string): BlockClipboardResult {
  return { ok: false, message: error instanceof ClipboardSerializationError ? error.message : fallback };
}

const envelope = (blocks: OrbisBlock[]) => ({schema_version: 2 as const, editor: 'blocknote' as const, blocks});
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function safeUrl(value: unknown, media = false): string {
  if (typeof value !== 'string') return '';
  if (!media && /^\/documents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:#[a-zA-Z0-9_-]+)?$/.test(value)) return value;
  if (parseFileReference(value) || /^orbis-doc:[a-zA-Z0-9-]+(?:#[a-zA-Z0-9-]+)?$/.test(value)) return value;
  const safe = safeContentUrl(value, media);
  if (!safe) return '';
  try {
    const url = new URL(safe, 'https://orbis.invalid');
    if (url.username || url.password || [...url.searchParams.keys()].some(key => /token|signature|credential|authorization|^(sig|se|sp|sv|key-pair-id|policy)$/i.test(key))) return '';
  } catch { return ''; }
  return safe;
}
function authoredProps(value: unknown) {
  const props = clipboardProps(value);
  for (const key of ['url','href']) if (key in props) props[key] = safeUrl(props[key], key === 'url');
  return props;
}
function sanitizeBlocks(input: unknown): OrbisBlock[] {
  let count = 0;
  const check = (depth: number) => { if (++count > MAX_NODES || depth > MAX_DEPTH) throw new Error('Clipboard limit'); };
  function inline(input: unknown, depth: number): OrbisInline[] | string {
    check(depth);
    if (typeof input === 'string') return input;
    if (!Array.isArray(input)) throw new Error('Invalid inline content');
    return input.flatMap((item): OrbisInline[] => {
      check(depth);
      if (!record(item)) throw new Error('Invalid inline');
      if (item.type === 'text' && typeof item.text === 'string') {
        const styles: Record<string, string | boolean> = {};
        if (record(item.styles)) for (const [key,value] of Object.entries(item.styles)) {
          if (['bold','italic','underline','strike','code'].includes(key) && value === true) styles[key] = true;
          if (['textColor','backgroundColor'].includes(key) && typeof value === 'string' && /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(value)) styles[key] = value;
        }
        return [{type:'text',text:item.text,...(Object.keys(styles).length ? {styles} : {})}];
      }
      if (item.type === 'link' && typeof item.href === 'string') {
        const content = inline(item.content,depth+1); const href = safeUrl(item.href);
        return href ? [{type:'link',href,content}] : typeof content === 'string' ? [{type:'text',text:content}] : content;
      }
      throw new Error('Invalid inline type');
    });
  }
  function cell(value: unknown, depth: number): OrbisTableCell {
    if (!record(value)) return inline(value,depth);
    if (value.type !== 'tableCell') throw new Error('Invalid cell');
    const props = authoredProps(value.props);
    for(const name of ['colspan','rowspan']) if(name in props && (!Number.isInteger(props[name]) || Number(props[name]) < 1 || Number(props[name]) > 100)) throw new Error('Invalid span');
    return {type:'tableCell',props,content:inline(value.content ?? [],depth)};
  }
  function blocks(input: unknown, depth: number): OrbisBlock[] {
    if (!Array.isArray(input)) throw new Error('Invalid blocks');
    return input.map((value): OrbisBlock => {
      check(depth);
      if (!record(value) || typeof value.type !== 'string' || !BASIC_TYPES.has(value.type) && !documentBlockDefinition(value.type)) throw new Error('Invalid block');
      const children = blocks(value.children ?? [],depth+1);
      const definition = documentBlockDefinition(value.type);
      if (Array.isArray(definition?.children) && children.some(child=>!definition.children.includes(child.type))) throw new Error('Invalid children');
      let content: OrbisBlock['content'];
      if(value.type === 'table') {
        const table=value.content;
        if (!record(table) || table.type!=='tableContent' || !Array.isArray(table.rows) || table.rows.length>1000) throw new Error('Invalid table');
        content={type:'tableContent',rows:table.rows.map(row=>{
          if(!record(row)||!Array.isArray(row.cells)||row.cells.length>1000)throw new Error('Invalid row');
          return {cells:row.cells.map(value=>cell(value,depth+1))};
        })};
        for(const key of ['headerRows','headerCols'] as const) if(table[key]!==undefined) {
          if(!Number.isInteger(table[key]) || Number(table[key])<0 || Number(table[key])>1000)throw new Error('Invalid header'); content[key]=Number(table[key]);
        }
        if(table.columnWidths!==undefined) {
          if(!Array.isArray(table.columnWidths)||table.columnWidths.length>1000||table.columnWidths.some(v=>v!==null&&(typeof v!=='number'||!Number.isFinite(v)||v<=0||v>10000)))throw new Error('Invalid widths');
          content.columnWidths=table.columnWidths as Array<number|null>;
        }
      } else content=inline(value.content ?? [],depth+1);
      return {id:typeof value.id==='string'&&value.id.length<=200?value.id:newBlockId(),type:value.type,props:authoredProps(value.props),content,children};
    });
  }
  return blocks(input,0);
}
export function parseBlockClipboard(raw: string): Payload | null {
  if (!raw || raw.length > MAX_BYTES) return null;
  try { const value:unknown=JSON.parse(raw);if(!record(value)||value.version!==1)return null;
    const blocks=sanitizeBlocks(value.blocks);if(!blocks.length)return null;
    return {version:1,blocks,...(typeof value.cutToken==='string'&&value.cutToken.length<200?{cutToken:value.cutToken}:{})};
  } catch { return null; }
}
export function serializeBlockClipboard(editor: Editor, ids: string[], cut = false): Serialized {
  const wanted=new Set(ids); const selected:OrbisBlock[]=[];
  // The storage contract represents table cells as inline content. Inspect live
  // nodes before that codec can flatten block structure and hide semantic loss.
  for (const entry of locateEditorBlocks(editor.state.doc)) {
    if (!wanted.has(entry.id)) continue;
    entry.node.descendants(node => {
      if (!['tableCell', 'tableHeader'].includes(node.type.name)) return;
      const paragraph = node.firstChild;
      const ownProps = paragraph?.attrs.orbisProps;
      if (node.childCount !== 1 || paragraph?.type.name !== 'paragraph' ||
          record(ownProps) && Object.keys(ownProps).length > 0) {
        throw new ClipboardSerializationError('表格单元格包含当前剪贴板格式无法完整保留的标题、列表、多段正文或段落属性，已取消复制/剪切，原内容已保留。');
      }
    });
  }

  function visit(blocks:OrbisBlock[]) { for(const block of blocks) if(wanted.has(block.id))selected.push(block);else visit(block.children); }
  visit(fromTiptapDocument(editor.state.doc).blocks);
  let blocks: OrbisBlock[];
  try { blocks=sanitizeBlocks(selected); }
  catch { throw new ClipboardSerializationError(LOSSY_COPY_MESSAGE); }
  // Inbound payloads may be sanitized. Outbound data must preserve every authored
  // field before a successful write can authorize deleting the source selection.
  if (canonicalJSON(authoredSemanticValue(selected)) !== canonicalJSON(authoredSemanticValue(blocks))) throw new ClipboardSerializationError(LOSSY_COPY_MESSAGE);
  if(!blocks.length)throw new ClipboardSerializationError('没有可复制的块');
  const payload:Payload={version:1,blocks,...(cut?{cutToken:newBlockId()}:{})};
  const structured=JSON.stringify(payload);if(structured.length>MAX_BYTES)throw new Error('选区超过剪贴板容量限制');
  const dom=editor.view.dom.ownerDocument.createElement('div');
  dom.setAttribute('data-orbis-block-clipboard',structured);
  const doc=editor.schema.nodeFromJSON(toTiptapDocument(envelope(blocks)));doc.check();
  dom.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(doc.content,{document:dom.ownerDocument}));
  return {structured,html:dom.outerHTML,text:extractPlainTextV2(blocks),payload};
}
function writeEvent(event: ClipboardEvent, data: Serialized) {
  if(!event.clipboardData)throw new Error('剪贴板不可用');
  event.clipboardData.setData('text/plain',data.text);
  event.clipboardData.setData('text/html',data.html);
  event.clipboardData.setData(BLOCK_CLIPBOARD_MIME,data.structured);
}
function finishCopy(editor:Editor,ids:string[],data:Serialized,cut:boolean,source:Editor['state']['doc']):BlockClipboardResult {
  if(!cut)return {ok:true,selectedIds:ids};
  if(editor.isDestroyed||editor.state.doc!==source)return {ok:false,message:'内容已变化，已复制但未剪切'};
  const result=executeBlockCommand(editor,ids,{type:'delete'});
  if(result.ok)cutSessions.set(editor,{token:data.payload.cutToken!,blocks:JSON.stringify(data.payload.blocks)});
  return result;
}
export async function copyBlocks(editor: Editor, ids: string[], cut = false): Promise<BlockClipboardResult> {
  if(cut&&!editor.isEditable)return {ok:false,message:'只读文档不能剪切'};
  try {
    const source=editor.state.doc;const data=serializeBlockClipboard(editor,ids,cut);
    let written=false;
    if(typeof ClipboardItem!=='undefined' && navigator.clipboard?.write)try {
      await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([data.html],{type:'text/html'}),'text/plain':new Blob([data.text],{type:'text/plain'})})]);written=true;
    } catch { /* Native copy remains available on insecure LAN origins. */ }
    if(!written) {
      const document=editor.view.dom.ownerDocument;
      const handler=(event:ClipboardEvent)=>{try{writeEvent(event,data);event.preventDefault();event.stopImmediatePropagation();written=true;}catch{written=false;}};
      document.addEventListener('copy',handler,true);
      try { document.execCommand?.('copy'); } finally {document.removeEventListener('copy',handler,true);}
    }
    if(!written)return {ok:false,message:'无法写入系统剪贴板，原内容已保留'};
    return finishCopy(editor,ids,data,cut,source);
  }catch(error){return copyFailure(error,'复制失败，原内容已保留');}
}
function readPayload(data: Pick<DataTransfer, 'getData'> | null,editor:Editor,blockMode:boolean):Payload|null {
  if(!data)return null;
  const custom=data.getData(BLOCK_CLIPBOARD_MIME);if(custom)return parseBlockClipboard(custom);
  const html=data.getData('text/html');if(html.length>MAX_BYTES)return null;
  const dom=editor.view.dom.ownerDocument.createElement('div');dom.innerHTML=html;
  const marked=dom.querySelector('[data-orbis-block-clipboard]');
  if(marked)return parseBlockClipboard(marked.getAttribute('data-orbis-block-clipboard')??'');
  if(!blockMode)return null;
  try {
    if(html) {
      const doc=ProseMirrorDOMParser.fromSchema(editor.schema).parse(dom);doc.check();
      return {version:1,blocks:sanitizeBlocks(fromTiptapDocument(doc).blocks)};
    }
    const text=data.getData('text/plain');if(!text||text.length>MAX_BYTES)return null;
    return {version:1,blocks:[{id:newBlockId(),type:'paragraph',props:{},content:text,children:[]}]};
  }catch{return null;}
}
function applyClipboardPayload(editor: Editor, ids: string[], payload: Payload): BlockClipboardResult {
  const entries=locateEditorBlocks(editor.state.doc);
  const active=entries.filter(entry=>entry.pos<=editor.state.selection.from&&entry.pos+entry.node.nodeSize>=editor.state.selection.from).at(-1);
  const targets=ids.length?ids:active?[active.id]:[];
  const session=cutSessions.get(editor);
  const existing=new Set(entries.map(entry=>entry.id));
  const incoming=[...indexBlocks(payload.blocks).keys()];
  const preserveIds=!!session&&session.token===payload.cutToken&&session.blocks===JSON.stringify(payload.blocks)&&incoming.every(id=>!existing.has(id));
  const result=executeBlockCommand(editor,targets,{type:'paste',blocks:payload.blocks,side:'after',preserveIds});
  if(result.ok&&preserveIds)cutSessions.delete(editor);return result;
}
const PASTE_READ_FALLBACK = '当前浏览器无法读取系统剪贴板。请在正文中长按并选择“粘贴”，或聚焦正文后按 Ctrl+V / ⌘+V。';
export async function pasteBlocks(editor: Editor, ids?: string[]): Promise<BlockClipboardResult> {
  if(editor.isDestroyed || !editor.isEditable)return {ok:false,message:'只读文档不能粘贴'};
  if(!navigator.clipboard?.read)return {ok:false,message:PASTE_READ_FALLBACK};
  const source=editor.state.doc;
  const targets=ids ?? blockSelectionKey.getState(editor.state)?.ids ?? [];
  try {
    const items=await navigator.clipboard.read();
    const values=new Map<string,string>();
    for(const item of items) for(const type of [BLOCK_CLIPBOARD_MIME,'text/html','text/plain']) {
      if(!item.types.includes(type)||values.has(type))continue;
      const blob=await item.getType(type);
      if(blob.size>MAX_BYTES)return {ok:false,message:'剪贴板内容超过容量限制，内容未修改'};
      const value=await blob.text();
      if(value.length>MAX_BYTES)return {ok:false,message:'剪贴板内容超过容量限制，内容未修改'};
      values.set(type,value);
    }
    if(editor.isDestroyed||!editor.isEditable||editor.state.doc!==source)return {ok:false,message:'文档已变化，请重新选择粘贴位置'};
    const payload=readPayload({getData:type=>values.get(type)??''},editor,true);
    if(!payload)return {ok:false,message:'剪贴板为空或块数据无效，内容未修改'};
    return applyClipboardPayload(editor,targets,payload);
  } catch {return {ok:false,message:PASTE_READ_FALLBACK};}
}
export function installBlockClipboard(editor:Editor,onResult:(result:BlockClipboardResult)=>void):()=>void {
  const dom=editor.view.dom;
  const handler=(event:ClipboardEvent)=>{
    if(event.defaultPrevented||editor.view.composing||isEmbeddedInput(event.target))return;
    const ids=blockSelectionKey.getState(editor.state)?.ids??[];
    if(event.type==='copy'||event.type==='cut') {
      if(!ids.length)return;
      if(event.type==='cut'&&!editor.isEditable){event.preventDefault();return;}
      try { const source=editor.state.doc;const cut=event.type==='cut';const data=serializeBlockClipboard(editor,ids,cut);writeEvent(event,data);event.preventDefault();event.stopImmediatePropagation();onResult(finishCopy(editor,ids,data,cut,source)); }
      catch(error) {event.preventDefault();event.stopImmediatePropagation();onResult(copyFailure(error,'剪贴板写入失败，原内容已保留'));}return;
    }
    if(!editor.isEditable)return;
    const payload=readPayload(event.clipboardData,editor,ids.length>0);
    if(!payload) {
      const recognized=!!event.clipboardData?.getData(BLOCK_CLIPBOARD_MIME)||!!event.clipboardData?.getData('text/html').includes('data-orbis-block-clipboard');
      if(recognized){event.preventDefault();event.stopImmediatePropagation();onResult({ok:false,message:'剪贴板块数据无效，内容未修改'});}
      return;
    }
    event.preventDefault();event.stopImmediatePropagation();
    onResult(applyClipboardPayload(editor,ids,payload));
  };
  for(const type of ['copy','cut','paste'])dom.addEventListener(type,handler as EventListener,true);
  return ()=>{for(const type of ['copy','cut','paste'])dom.removeEventListener(type,handler as EventListener,true);cutSessions.delete(editor);};
}
