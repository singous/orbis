import { NAVIGATE_OUTLINE_EVENT } from "../outline-navigation";
import { BOARD_REMOVAL_EVENT, confirmBoardRemoval, type BoardRemovalRequest } from "./board-removal";
import { BoardDiscardDialog } from "../../../boards/BoardDiscardDialog";
import { showToast } from "../../../../shared/ui/Toast";
import { reportError } from "../../../../shared/api/request-feedback";
import {DocumentCopyContext,registerDocumentCopy,prepareTableCopy,selectedTableBlocks} from "./block-copy-context";
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { inlineTransactionsOnly } from '../tiptap-inline-change';
import { useContext,useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Plus, Copy, Link2, ArrowUp, ArrowDown, Layers, Trash2, ChevronRight } from '../../../../shared/ui/icons';
import { ActionButton } from '../../../../shared/ui/ActionButton';
import { SelectField } from '../../../../shared/ui/SelectField';
import { DOCUMENT_BLOCKS } from '../../../content/model/document-components';
import { newBlockId } from '../../../content/blocks';
import { fromTiptapDocument } from '../tiptap-model';
import { executeBlockCommand, locateEditorBlocks, ownedOrbisBlock, type BlockAction } from './block-commands';
import { blockActionAvailability, createBlockActionContext, BLOCK_GROUP_KINDS } from './block-capabilities';
import { indexBlocks } from './block-tree';
import { blockSelectionKey, clearBlockSelection, isEmbeddedInput, selectBlock, setBlockSelection, setBlockTarget } from './block-selection';
import { copyBlocks, pasteBlocks, installBlockClipboard, type BlockClipboardResult } from './block-clipboard';
import { blockActionNeedsRead, prepareBlockAction } from './block-action-read';
import '../../../../styles/block-controls.css';

const LABELS:Record<string,string>={paragraph:'段落',heading:'标题',bulletListItem:'无序列表',numberedListItem:'有序列表',checkListItem:'任务清单',quote:'引用',codeBlock:'代码块',table:'表格',board:'画板',image:'图片',video:'视频',audio:'音频',file:'附件',divider:'分隔线',toggleListItem:'折叠块',...Object.fromEntries(Object.entries(DOCUMENT_BLOCKS).map(([kind,definition])=>[kind,definition.label]))};
const CONVERSIONS=[{value:'paragraph',label:'段落'},{value:'heading:1',label:'标题 1'},{value:'heading:2',label:'标题 2'},{value:'heading:3',label:'标题 3'},{value:'bulletListItem',label:'无序列表'},{value:'numberedListItem',label:'有序列表'},{value:'checkListItem',label:'任务清单'},{value:'quote',label:'引用'},{value:'codeBlock',label:'代码块'},{value:'toggleListItem',label:'折叠块'}];
const OPEN_BLOCK_MENU_EVENT = 'orbis-open-block-menu';
export function requestBlockMenu(editor: Editor) { editor.view.dom.dispatchEvent(new Event(OPEN_BLOCK_MENU_EVENT)); }

const DRAG_MIME='application/x-orbis-block-drag';
const EDGE_SCROLL_DISTANCE=56;
const MAX_SCROLL_STEP=16;
const HANDLE_CLEARANCE=16;
type DropTarget={id:string;placement:'before'|'after'|'inside';ok:boolean;message?:string;rect:{top:number;left:number;width:number;height:number}};

/** Inline input preserves block identity and geometry above the active block. */
function inlineOnly(transaction:Transaction):boolean {
 return transaction.docChanged && inlineTransactionsOnly([transaction]);
}

export function BlockControls({editor,readOnly,noteId}:{editor:Editor;readOnly:boolean;noteId?:string}) {
 const copyPort=useContext(DocumentCopyContext);
 useEffect(()=>copyPort?registerDocumentCopy(editor,copyPort):undefined,[editor,copyPort]);
 const [doc,setDoc]=useState(editor.state.doc);
 const liveDoc=useRef(editor.state.doc);
 const [selection,setSelection]=useState(blockSelectionKey.getState(editor.state));
 const [activeId,commitActiveId]=useState<string|null>(null);
 const [point,setPoint]=useState<{top:number;left:number}|null>(null);
 const [open,setOpen]=useState(false);
 const [removal,setRemoval]=useState<BoardRemovalRequest|null>(null);
 useLayoutEffect(()=>{
  setRemoval(null);
  const request=(event:Event)=>{setNotice('');setOpen(false);setRemoval((event as CustomEvent<BoardRemovalRequest>).detail);};
  const dom=editor.view.dom;
  dom.addEventListener(BOARD_REMOVAL_EVENT,request);
  return()=>dom.removeEventListener(BOARD_REMOVAL_EVENT,request);
 },[editor]);
 const [menuPoint,setMenuPoint]=useState({top:0,left:0});
 const setNotice = (message: string) => { if (message) showToast({ title: message }); };
 const [drop,setDrop]=useState<DropTarget|null>(null);
 const [dragToken]=useState(newBlockId);
 const handleRef=useRef<HTMLButtonElement>(null);
 const controlsRef=useRef<HTMLDivElement>(null);
 const menuRef=useRef<HTMLDivElement>(null);
 const activeRef=useRef(activeId);activeRef.current=activeId;
 const dragRef=useRef<string[]|null>(null);
 const dragPreviewRef=useRef<HTMLDivElement|null>(null);
 const dropRef=useRef<DropTarget|null>(null);
 const source=useMemo(()=>fromTiptapDocument(doc).blocks,[doc]);
 const index=useMemo(()=>indexBlocks(source),[source]);
 const current=activeId?index.get(activeId)?.block:undefined;
 const parentId=activeId?index.get(activeId)?.parentId:null;
 const parentBlock=parentId?index.get(parentId)?.block:undefined;
 const ids=selection?.ids.length?selection.ids:activeId?[activeId]:[];
 const actionContext=useMemo(()=>createBlockActionContext(source,ids,index),[source,index,selection?.ids,activeId]);
 const idsRef=useRef(ids);idsRef.current=ids;
 const readonlyRef=useRef(readOnly);readonlyRef.current=readOnly;
 const activeEditor = useRef<typeof editor | null>(editor);
 useEffect(() => {
  activeEditor.current = editor;
  return () => { if (activeEditor.current === editor) activeEditor.current = null; };
 }, [editor]);
 const menuOpenRef=useRef(open);menuOpenRef.current=open;

 function setActiveId(id:string|null) {
  if(activeRef.current===id)return;
  activeRef.current=id;commitActiveId(id);
  setDoc(editor.state.doc);
 }

 function receive(result:BlockClipboardResult) {
  if (activeEditor.current !== editor || editor.isDestroyed) return;
  if(result.ok && result.selectedIds) {
   setBlockSelection(editor,result.selectedIds);
   setActiveId(result.selectedIds[0]??null);
  }
  if (result.ok) { if (result.message) setNotice(result.message); }
  else reportError(result.error ?? result.message ?? '复制失败，原内容已保留');
 }
 function copySelected(cut=false) {
  const chosen=[...idsRef.current];

  void copyBlocks(editor,chosen,cut).then(receive);
  setOpen(false);
 }
 function run(action:BlockAction) {
  if(readonlyRef.current)return;
  const chosen=[...idsRef.current];
  if (action.type==='duplicate'&&selectedTableBlocks(editor,chosen)||['duplicate','ungroup'].includes(action.type) && blockActionNeedsRead(editor,chosen)) {
   setOpen(false);
   void (action.type==='duplicate'?prepareTableCopy(editor,chosen):prepareBlockAction(editor,chosen)).then(()=>perform(action,chosen)).catch(reportError);
   return;
  }
  perform(action,chosen);
 }
 function perform(action:BlockAction,chosen:string[]) {
  if(editor.isDestroyed||readonlyRef.current)return;
  const result=executeBlockCommand(editor,chosen,action);
  setOpen(false);
  if(!result.ok){reportError(result.message??'无法完成此操作');return;}
  setBlockSelection(editor,action.type==='insert'?[]:result.selectedIds);
  setActiveId(result.selectedIds[0]??null);
  editor.view.focus();
 }
 const runRef=useRef(run);runRef.current=run;

 function positionHandle(id:string|null) {
  const entry=locateEditorBlocks(editor.state.doc).find(value=>value.id===id);
  const element=entry?editor.view.nodeDOM(entry.pos):null;
  const root=editor.view.dom.closest('.orbis-tiptap');
  if(!(element instanceof HTMLElement)||!root){setPoint(null);return;}
  const ownRect=element.getBoundingClientRect();
  // Empty transparent containers have no hit area until their children load.
  // The sibling read control remains an explicit handle for that same block.
  const loader=ownRect.height?null:[...editor.view.dom.querySelectorAll<HTMLElement>('[data-block-loader]')].find(node=>node.dataset.blockLoader===id);
  const rect=loader?.getBoundingClientRect()??ownRect, parent=root.getBoundingClientRect();
  const controlsRect=controlsRef.current?.getBoundingClientRect();
  const controlsWidth=controlsRect?.width??0;
  const center=firstTextLineCenter(element)??rect.top+parseFloat(getComputedStyle(element).lineHeight||'0')/2;
  const next={top:(Number.isFinite(center)?center:rect.top+rect.height/2)-parent.top-(controlsRect?.height??0)/2,left:Math.max(HANDLE_CLEARANCE-parent.left,rect.left-parent.left-controlsWidth-HANDLE_CLEARANCE)};
  setPoint(previous=>previous?.top===next.top&&previous?.left===next.left?previous:next);
 }
 useLayoutEffect(()=>{positionHandle(activeId);},[activeId,doc,Boolean(point),readOnly,selection?.ids.length]);

 useEffect(()=>{
  const sync=({transaction}:{transaction:Transaction})=>{
   liveDoc.current=editor.state.doc;
   const inline=inlineOnly(transaction);
   if(transaction.docChanged&&(menuOpenRef.current||!inline))setDoc(liveDoc.current);
   const next=blockSelectionKey.getState(editor.state);
   setSelection(previous=>previous===next||previous&&next&&previous.anchorId===next.anchorId&&previous.focusId===next.focusId&&previous.targetId===next.targetId&&previous.ids.length===next.ids.length&&previous.ids.every((id,index)=>id===next.ids[index])?previous:next);
   if(!menuOpenRef.current&&!dragRef.current) {
    if(!editor.view.hasFocus())return;
    const mapped=editor.view.domAtPos(editor.state.selection.from).node;
    const element=mapped instanceof Element?mapped:mapped.parentElement;
    const caretId=element?.closest<HTMLElement>('[data-orbis-block-id]')?.dataset.orbisBlockId;
    if(inline&&caretId&&caretId===activeRef.current){positionHandle(caretId);return;}
    const current=ownedOrbisBlock(liveDoc.current,editor.state.selection.from);
    if(current)setActiveId(current.id);
   }
  };
  editor.on('transaction',sync);
  const cleanup=installBlockClipboard(editor,receive);
  return()=>{editor.off('transaction',sync);cleanup();};
 },[editor]);

 useEffect(()=>{
  const dom=editor.view.dom;
  const root=dom.closest('.orbis-tiptap')??dom;
  const dragSurface=dom.closest('.document-scroll-region,.workspace-content')??root;
  let moveFrame=0,scrollFrame=0;
  let lastPointer:{x:number;y:number}|null=null;
  let expandTimer:ReturnType<typeof setTimeout>|undefined;
  let expandTarget:Element|null=null;
  const blockAt=(target:EventTarget|null,x:number,y:number)=>{
   try {
    const targetElement=target instanceof Element?target:target instanceof Node?target.parentElement:null;
    const loader=targetElement?.closest<HTMLElement>('[data-block-loader]');
    if(loader&&dom.contains(loader))return locateEditorBlocks(editor.state.doc).find(entry=>entry.id===loader.dataset.blockLoader);
    const hit = targetElement?.closest<HTMLElement>('[data-orbis-block-id]');
    if (hit && dom.contains(hit)) return locateEditorBlocks(editor.state.doc).find(entry => entry.id === hit.dataset.orbisBlockId);
    // 容器空白处按鼠标坐标定位，DOM offset 0 会错误命中第一个块。
    const bounds=dom.getBoundingClientRect();
    const found=editor.view.posAtCoords({left:Math.max(bounds.left+2,Math.min(bounds.right-2,x)),top:y});
    return found?ownedOrbisBlock(editor.state.doc,found.pos):undefined;
   }catch{return undefined;}
  };
  const pointer=(event:Event)=>{
   const e=event as PointerEvent;
   if(menuOpenRef.current||dragRef.current||controlsRef.current?.contains(e.target as Node))return;
   const entry=blockAt(e.target,e.clientX,e.clientY);
   if(!entry)return;
   cancelAnimationFrame(moveFrame);
   moveFrame=requestAnimationFrame(()=>{setActiveId(entry.id);positionHandle(entry.id);});
  };
  const key=(event:KeyboardEvent)=>{
   if(event.isComposing||editor.view.composing||isEmbeddedInput(event.target)||!blockSelectionKey.getState(editor.state)?.ids.length)return;
   if(event.altKey && event.key==='ArrowLeft') {
    const first=ownedOrbisBlock(editor.state.doc,editor.state.selection.from);
    const selected=locateEditorBlocks(editor.state.doc).find(entry=>entry.id===idsRef.current[0])??first;
    if(selected?.parentId){event.preventDefault();event.stopPropagation();setBlockSelection(editor,[selected.parentId]);setActiveId(selected.parentId);}
    return;
   }
   if(readonlyRef.current)return;
   let action:BlockAction|undefined;
   if(event.key==='Backspace'||event.key==='Delete')action={type:'delete'};
   else if(event.key==='Tab')action={type:event.shiftKey?'outdent':'indent'};
   else if(event.altKey&&event.key==='ArrowUp')action={type:'up'};
   else if(event.altKey&&event.key==='ArrowDown')action={type:'down'};
   else if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='d')action={type:'duplicate'};
   else if(event.key==='Enter')action={type:'insert',side:'after'};
   if(action){event.preventDefault();event.stopPropagation();runRef.current(action);}
   else if(event.key.length===1&&!event.metaKey&&!event.ctrlKey&&!event.altKey)clearBlockSelection(editor);
  };
  const clearDrag=()=>{dragPreviewRef.current?.remove();dragPreviewRef.current=null;root.classList.remove('is-block-dragging');dragRef.current=null;dropRef.current=null;setDrop(null);cancelAnimationFrame(scrollFrame);clearTimeout(expandTimer);expandTarget=null;};
  const updateDrop=(target:EventTarget|null,x:number,y:number)=>{
   if(!dragRef.current)return;
   const entry=blockAt(target,x,y);
   const element=entry?editor.view.nodeDOM(entry.pos):null;
   if(!entry||!(element instanceof HTMLElement)){dropRef.current=null;setDrop(null);clearTimeout(expandTimer);expandTarget=null;return;}
   const rect=element.getBoundingClientRect();const ratio=(y-rect.top)/Math.max(rect.height,1);
   const placement=ratio>.24&&ratio<.76&&x>rect.left+28?'inside':ratio<.5?'before':'after';
   const availability=blockActionAvailability(fromTiptapDocument(editor.state.doc).blocks,dragRef.current,{type:'move',targetId:entry.id,placement});
   const collapsed=placement==='inside'&&element instanceof HTMLDetailsElement&&!element.open;
   const next:DropTarget={id:entry.id,placement,ok:availability.ok&&!collapsed,message:collapsed?'展开后可放入此块':availability.message,rect:{top:rect.top,left:rect.left,width:rect.width,height:rect.height}};
   dropRef.current=next;setDrop(next);
   const pane=target instanceof Element?target.closest('[role="tab"][aria-selected="false"]'):null;
   const expandable=collapsed?element:pane;
   if(expandable!==expandTarget){clearTimeout(expandTimer);expandTarget=expandable;if(expandable)expandTimer=setTimeout(()=>{
    if(!dragRef.current)return;
    if(expandable instanceof HTMLDetailsElement)expandable.open=true;
    else if(expandable instanceof HTMLElement)expandable.click();
    if(lastPointer)updateDrop(document.elementFromPoint(lastPointer.x,lastPointer.y),lastPointer.x,lastPointer.y);
   },600);}
  };
  const scrollTick=()=>{
   if(!dragRef.current||!lastPointer)return;
   const scroller=dom.closest<HTMLElement>('.document-scroll-region,.workspace-content');
   if(scroller){const bounds=scroller.getBoundingClientRect();const y=lastPointer.y;const step=y<bounds.top+EDGE_SCROLL_DISTANCE?-Math.min(MAX_SCROLL_STEP,(bounds.top+EDGE_SCROLL_DISTANCE-y)/3):y>bounds.bottom-EDGE_SCROLL_DISTANCE?Math.min(MAX_SCROLL_STEP,(y-bounds.bottom+EDGE_SCROLL_DISTANCE)/3):0;
    if(step){scroller.scrollTop+=step;updateDrop(document.elementFromPoint(lastPointer.x,y),lastPointer.x,y);}
   }
   scrollFrame=requestAnimationFrame(scrollTick);
  };
  const dragOver=(event:Event)=>{
   const e=event as DragEvent;if(!dragRef.current||readonlyRef.current)return;
   e.preventDefault();e.stopPropagation();lastPointer={x:e.clientX,y:e.clientY};
   updateDrop(e.target,e.clientX,e.clientY);
   if(e.dataTransfer)e.dataTransfer.dropEffect=dropRef.current?.ok?'move':'none';
   if(!scrollFrame)scrollFrame=requestAnimationFrame(scrollTick);
  };
  const dropped=(event:Event)=>{
   const e=event as DragEvent;if(!dragRef.current)return;
   e.preventDefault();e.stopPropagation();
   updateDrop(e.target,e.clientX,e.clientY);
   const selected=dragRef.current;const target=dropRef.current;
   const trusted=e.dataTransfer?.getData(DRAG_MIME)===dragToken;
   clearDrag();scrollFrame=0;
   if(trusted&&target?.ok&&!readonlyRef.current){const result=executeBlockCommand(editor,selected,{type:'move',targetId:target.id,placement:target.placement});receive(result);editor.view.focus();}
   else if(target&&!target.ok)reportError(target.message??'此位置不能放置所选块');
  };
  const end=()=>{clearDrag();scrollFrame=0;};
  const resize=(event:Event)=>{
   positionHandle(activeRef.current);
   // 表格内部滚动不改变块菜单锚点；单元格保存后的滚动恢复也不能关闭菜单。
   const insideEmbed=event.type==='scroll'&&event.target instanceof Element&&event.target.closest('[data-orbis-embedded-editor]');
   if(menuOpenRef.current && !insideEmbed && !(event.target instanceof Node && menuRef.current?.contains(event.target)))setOpen(false);
  };
  const openRequested=()=>{
   const id=blockSelectionKey.getState(editor.state)?.ids[0]??ownedOrbisBlock(editor.state.doc,editor.state.selection.from)?.id;
   if(!id)return;
   setDoc(editor.state.doc);setActiveId(id);positionHandle(id);
   if(!blockSelectionKey.getState(editor.state)?.ids.length)selectBlock(editor,id);
   setOpen(true);
  };
  const layoutObserver=new ResizeObserver(()=>positionHandle(activeRef.current));
  layoutObserver.observe(root);
  dom.addEventListener(OPEN_BLOCK_MENU_EVENT,openRequested);
  root.addEventListener('pointermove',pointer);root.addEventListener('pointerdown',pointer);
  dom.addEventListener('keydown',key,true);
  dragSurface.addEventListener('dragover',dragOver,true);dragSurface.addEventListener('drop',dropped,true);
  document.addEventListener('dragend',end);window.addEventListener('resize',resize);document.addEventListener('scroll',resize,true);
  return()=>{layoutObserver.disconnect();dom.removeEventListener(OPEN_BLOCK_MENU_EVENT,openRequested);cancelAnimationFrame(moveFrame);clearDrag();root.removeEventListener('pointermove',pointer);root.removeEventListener('pointerdown',pointer);dom.removeEventListener('keydown',key,true);dragSurface.removeEventListener('dragover',dragOver,true);dragSurface.removeEventListener('drop',dropped,true);document.removeEventListener('dragend',end);window.removeEventListener('resize',resize);document.removeEventListener('scroll',resize,true);};
 },[editor,dragToken]);

 useEffect(()=>{
  if(!open)return;
  const close=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node)&&!controlsRef.current?.contains(event.target as Node))setOpen(false);};
  document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);
 },[open]);
 useLayoutEffect(()=>{
  if(!open)return;const rect=handleRef.current?.getBoundingClientRect();if(!rect)return;
  const height=Math.min(500,window.innerHeight-40);
  setMenuPoint({left:Math.max(12,Math.min(rect.left,window.innerWidth-260)),top:Math.max(12,Math.min(rect.bottom+5,window.innerHeight-height-12))});
  menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
 },[open]);
 useEffect(()=>{
  if(!noteId)return;
  let cancel=0;
  let clearTarget:ReturnType<typeof setTimeout>|undefined;
  const locate=(event?:Event)=>{
   const outlineId=event?.type===NAVIGATE_OUTLINE_EVENT?(event as CustomEvent<string>).detail:null;
   const hash=window.location.hash;if(!outlineId&&!hash.startsWith('#block-'))return;
   let id:string;try{id=outlineId??decodeURIComponent(hash.slice(7));}catch{return;}
   const entry=locateEditorBlocks(editor.state.doc).find(item=>item.id===id);
   if(!entry){reportError('目标块已不存在或无法访问');return;}
   const node=editor.view.nodeDOM(entry.pos);if(!(node instanceof HTMLElement))return;
   for(let parent=node.parentElement;parent;parent=parent.parentElement) {
    if(parent instanceof HTMLDetailsElement)parent.open=true;
    if(parent.style.display==='none'&&parent.parentElement) {
     const group=parent.parentElement.closest('[data-document-component="tabs"],[data-document-component="codeGroup"]');
     const index=Array.from(parent.parentElement.children).indexOf(parent);
     group?.querySelectorAll<HTMLElement>(':scope > [role="tablist"] > [role="tab"]')[index]?.click();
    }
   }
   clearBlockSelection(editor);setBlockTarget(editor,id);setActiveId(id);
   clearTimeout(clearTarget);clearTarget=setTimeout(()=>setBlockTarget(editor,null),1800);
   cancel=requestAnimationFrame(()=>node.scrollIntoView?.({block:'center',behavior:outlineId&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'auto'}));
  };
  locate();window.addEventListener('hashchange',locate);editor.view.dom.addEventListener(NAVIGATE_OUTLINE_EVENT,locate);return()=>{window.removeEventListener('hashchange',locate);editor.view.dom.removeEventListener(NAVIGATE_OUTLINE_EVENT,locate);cancelAnimationFrame(cancel);clearTimeout(clearTarget);};
 },[editor,noteId]);

 async function copyLink(){
  if(!activeId||!noteId)return;
  const url=new URL(`/documents/${noteId}`,window.location.origin);url.hash=`block-${encodeURIComponent(activeId)}`;
  try{await navigator.clipboard.writeText(url.href);setNotice('块链接已复制');}catch{
   const input=document.createElement('textarea');input.value=url.href;input.style.cssText='position:fixed;left:-9999px';document.body.append(input);input.select();
   try{if(!document.execCommand('copy'))throw Error('Copy failed');setNotice('块链接已复制');}catch{reportError('无法写入剪贴板，请使用浏览器复制功能');}finally{input.remove();editor.view.focus();}
  }setOpen(false);
 }
 const availability=(action:BlockAction)=>blockActionAvailability(source,ids,action,actionContext);
 const actionItem=(label:string,action:BlockAction,icon?:React.ReactNode)=>{
  const allowed=availability(action);
  return <ActionButton key={label} role="menuitem" className={action.type==='delete'?'block-action-danger':''} disabled={!allowed.ok} title={allowed.message} onClick={()=>run(action)}>{icon}<span>{label}</span></ActionButton>;
 };
 const convertOptions=open?CONVERSIONS.filter(option=>{const [target,level]=option.value.split(':');return availability({type:'convert',target,level:level?Number(level):undefined}).ok;}):[];
 return <>
  {current&&point?<div ref={controlsRef} className="orbis-block-controls" contentEditable={false} style={point}>
   <button type="button" ref={handleRef} className="block-grip" aria-label={`块操作：${LABELS[current.type]??current.type}`} aria-haspopup="menu" aria-expanded={open} title="点击打开块菜单 · 拖动移动块" draggable={!readOnly} onClick={event=>{
    setDoc(editor.state.doc);
    if (event.shiftKey || event.metaKey || event.ctrlKey || !blockSelectionKey.getState(editor.state)?.ids.includes(current.id)) selectBlock(editor,current.id,{shift:event.shiftKey,toggle:event.metaKey||event.ctrlKey});
    if(event.shiftKey||event.ctrlKey||event.metaKey){setOpen(false);editor.view.focus();}else setOpen(value=>!value);
   }} onDragStart={event=>{
    if(readOnly){event.preventDefault();return;}
    let selected=blockSelectionKey.getState(editor.state)?.ids??[];if(!selected.includes(current.id)){selectBlock(editor,current.id);selected=[current.id];}
    dragRef.current=selected;event.dataTransfer.setData(DRAG_MIME,dragToken);event.dataTransfer.effectAllowed='move';setOpen(false);
    const preview=document.createElement('div');
    preview.className='orbis-block-drag-preview';preview.setAttribute('aria-hidden','true');
    const label=document.createElement('div');label.className='block-drag-preview-label';
    label.textContent=selected.length>1?`移动 ${selected.length} 个块`:LABELS[current.type]??current.type;
    const text=document.createElement('div');text.className='block-drag-preview-text';
    const node=locateEditorBlocks(editor.state.doc).find(entry=>entry.id===current.id)?.node;
    text.textContent=node?.textBetween(0,node.content.size,' ').trim().slice(0,120)||label.textContent;
    preview.append(label,text);document.body.append(preview);dragPreviewRef.current=preview;
    event.dataTransfer.setDragImage(preview,16,16);
    editor.view.dom.closest('.orbis-tiptap')?.classList.add('is-block-dragging');
   }}><GripVertical size="1em" viewBox="3 3 18 18"/></button>
   {selection?.ids.length? <span className="block-selection-count" aria-live="polite">{selection.ids.length>1?`${selection.ids.length} 块`:''}</span>:null}
  </div>:null}
  {open&&current?createPortal(<div ref={menuRef} className="orbis-block-menu" role="menu" aria-label="块操作" style={{top:menuPoint.top,left:menuPoint.left}} onKeyDown={event=>{
   if ((event.ctrlKey||event.metaKey) && ['c','x','v'].includes(event.key.toLowerCase())) {
    const key=event.key.toLowerCase();setOpen(false);editor.view.focus();
    if(key!=='v'){event.preventDefault();copySelected(key==='x');}return;
   }
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);editor.view.focus();}
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&!(event.target instanceof Element&&event.target.closest('[role="listbox"]'))){const buttons=Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')??[]);if(!buttons.length)return;event.preventDefault();const current=buttons.indexOf(document.activeElement as HTMLButtonElement);const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;buttons[next].focus();}
  }}>
   <div className="block-menu-heading">{ids.length>1?`已选择 ${ids.length} 个块`:LABELS[current.type]??current.type}<span>块操作</span></div>
   {parentBlock?<ActionButton role="menuitem" onClick={()=>{setBlockSelection(editor,[parentBlock.id]);setActiveId(parentBlock.id);}}><ArrowUp size={15}/><span>选择父块：{LABELS[parentBlock.type]??parentBlock.type}</span></ActionButton>:null}
   <ActionButton role="menuitem" onClick={()=>copySelected()}><Copy size={15}/><span>复制块</span><kbd aria-hidden="true">⌘ C</kbd></ActionButton>
   {!readOnly?<ActionButton role="menuitem" onClick={()=>{editor.view.focus();void pasteBlocks(editor,ids).then(receive);setOpen(false);}}><Copy size={15}/><span>粘贴块</span><kbd aria-hidden="true">⌘ V</kbd></ActionButton>:null}
   <ActionButton role="menuitem" disabled={!noteId} onClick={()=>void copyLink()}><Link2 size={15}/><span>复制块链接</span></ActionButton>
   {!readOnly?<>
    <ActionButton role="menuitem" onClick={()=>copySelected(true)}><span className="block-menu-icon">✂</span><span>剪切块</span><kbd aria-hidden="true">⌘ X</kbd></ActionButton>
    {actionItem('创建副本',{type:'duplicate'},<Copy size={15}/>)}
    <div className="block-menu-separator"/>
    {convertOptions.length?<SelectField aria-label="转换块类型" value={current.type==='heading'?`heading:${current.props.level??1}`:current.type} options={convertOptions} onChange={value=>{const [target,level]=value.split(':');run({type:'convert',target,level:level?Number(level):undefined});}}/>:null}
    {actionItem('在上方插入',{type:'insert',side:'before'},<Plus size={15}/>)}
    {actionItem('在下方插入',{type:'insert',side:'after'},<Plus size={15}/>)}
    {actionItem('上移',{type:'up'},<ArrowUp size={15}/>)}
    {actionItem('下移',{type:'down'},<ArrowDown size={15}/>)}
    {actionItem('增加缩进',{type:'indent'},<ChevronRight size={15}/>)}
    {actionItem('提升层级',{type:'outdent'},<ChevronRight size={15} style={{transform:'rotate(180deg)'}}/>)}
    <div className="block-menu-separator"/>
    {BLOCK_GROUP_KINDS.map(kind=>actionItem(kind==='group'?'组合':`组合为${LABELS[kind]}`,{type:'group',kind},<Layers size={15}/>))}
    {actionItem('取消组合',{type:'ungroup'},<Layers size={15}/>)}
    <div className="block-menu-separator"/>
    {actionItem('删除',{type:'delete'},<Trash2 size={15}/>)}
   </>:null}
  </div>,document.body):null}
  {drop?createPortal(<div className={`orbis-block-drop ${drop.placement==='inside'?'is-inside':''} ${drop.ok?'':'is-invalid'}`} style={{top:drop.placement==='after'?drop.rect.top+drop.rect.height:drop.rect.top,left:drop.rect.left,width:drop.rect.width,height:drop.placement==='inside'?drop.rect.height:2}}><span className={drop.ok&&drop.placement!=='inside'?'sr-only':undefined}>{drop.ok?(drop.placement==='inside'?'放入此块':drop.placement==='before'?'移动到上方':'移动到下方'):drop.message}</span></div>,document.body):null}
 <BoardDiscardDialog open={removal!==null}
   description="这个操作会结束当前画板编辑，未保存的修改不会恢复。可以保留当前内容重试保存，或放弃修改后继续。"
   cancelLabel="保留画板块" discardLabel="放弃并继续" onCancel={()=>setRemoval(null)}
   onDiscard={()=>{
      const request=removal;setRemoval(null);
      if(request&&!confirmBoardRemoval(editor,request))setNotice('文档状态已变化，请重新执行操作。');
   }}
 /></>;
}

function firstTextLineCenter(element:HTMLElement):number|null {
 const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
 const range=document.createRange();
 for(let node=walker.nextNode();node;node=walker.nextNode()) {
  const offset=node.textContent?.search(/\S/)??-1;
  if(offset<0||node.parentElement?.closest('button,svg,[aria-hidden="true"]'))continue;
  range.setStart(node,offset);range.setEnd(node,offset+1);
  const rect=range.getClientRects()[0];
  if(rect?.height)return rect.top+rect.height/2;
 }
 return null;
}
