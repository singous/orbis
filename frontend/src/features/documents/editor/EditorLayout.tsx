import { editorOutlineLinkClassName } from "./editor-control-styles";
import { reportError } from "../../../shared/api/request-feedback";
import { NAVIGATE_OUTLINE_EVENT } from "./outline-navigation";
import { useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown } from "@orbis/ui/icons";
import { Portal } from "@orbis/ui/portal";
import { useEditorOutlineHost } from "./EditorToolbarHost";
import { Button } from "@orbis/ui/button";
import { extractPlainTextV2, type NoteBlocksV2, type OrbisBlock } from "../../content/blocks";

import type {BlockLoadState} from "./content-window";

type Heading = { id: string; text: string; level: number };
type IndexedHeading=Heading & {root_index:number;parent_id?:string|null};

/** Only changed headings notify the outline; body keystrokes stay in the editor. */
export class EditorOutlineStore {
  #headings: Heading[] = [];
  #listeners = new Set<() => void>();
  #cache = new WeakMap<OrbisBlock, Heading>();
  #remote: IndexedHeading[] = [];
  #boundary = Infinity;
  #roots: OrbisBlock[] = [];
  #sourceRoots = new Map<number,string>();
  #states: ReadonlyMap<string,BlockLoadState> = new Map();
  setRemote(headings: IndexedHeading[], boundary: number) { this.#remote = headings; this.#boundary = boundary; this.#publish(); }
  setBoundary(boundary: number) { this.#boundary = boundary; }
  setReadState(states: ReadonlyMap<string,BlockLoadState>) { this.#states=states; }
  isPayloadLoaded(id: string) { return this.#states.get(id)?.payload_loaded !== false; }
  setSourceRoots(roots: OrbisBlock[],firstPosition=0) {
    for(const [index,root] of roots.entries())this.#sourceRoots.set(firstPosition+index,root.id);
  }
  reset() { this.#remote=[];this.#sourceRoots.clear();this.#roots=[];this.#states=new Map(); }
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };
  snapshot = () => this.#headings;
  update(blocks: NoteBlocksV2) { this.#roots=blocks.blocks;this.#publish(); }
  #publish() {
    const known=new Set<string>(),rootIDs=new Set(this.#roots.map(root=>root.id));
    const collect=(blocks:OrbisBlock[])=>{for(const block of blocks){known.add(block.id);collect(block.children);}};
    collect(this.#roots);
    const pending=new Map<string,IndexedHeading[]>();
    const indexedByRoot=new Map<string,IndexedHeading[]>();
    for(const heading of this.#remote){const rootID=this.#sourceRoots.get(heading.root_index);if(rootID){const entries=indexedByRoot.get(rootID)??[];entries.push(heading);indexedByRoot.set(rootID,entries);}}
    const tail:Heading[]=[];
    for(const heading of this.#remote){
      const state=this.#states.get(heading.id);
      if(known.has(heading.id)&&state?.payload_loaded!==false)continue;
      if(heading.parent_id&&this.#states.has(heading.parent_id)&&!known.has(heading.parent_id))continue;
      const sourceRoot=this.#sourceRoots.get(heading.root_index);
      if(sourceRoot){
        if(!rootIDs.has(sourceRoot))continue;
        const entries=pending.get(sourceRoot)??[];entries.push(heading);pending.set(sourceRoot,entries);
      }else if(heading.root_index>=this.#boundary)tail.push(heading);
    }
    const next:Heading[]=[];
    for(const root of this.#roots){
      const loaded:Heading[]=[];
      const visit=(block:OrbisBlock)=>{
        if(block.type==="heading"&&this.#states.get(block.id)?.payload_loaded!==false){
          let heading=this.#cache.get(block);
          if(!heading){heading={id:block.id,level:Number(block.props.level??1),text:extractPlainTextV2([{...block,children:[]}])||"未命名标题"};this.#cache.set(block,heading);}
          loaded.push(heading);
        }
        block.children.forEach(visit);
      };
      visit(root);
      const unresolved=pending.get(root.id)??[];
      // Preserve indexed descendants while this root still owns an unread subtree or payload.
      const unread=(block:OrbisBlock):boolean=>{const state=this.#states.get(block.id);return Boolean(state&&(!state.children_loaded||!state.payload_loaded))||block.children.some(unread);};
      const retain=new Set((unread(root)?unresolved:[]).map(heading=>heading.id));
      const loadedIDs=new Set(loaded.map(heading=>heading.id));
      const after=new Map<string,Heading[]>();let anchor="";
      for(const indexed of indexedByRoot.get(root.id)??[]){
        if(loadedIDs.has(indexed.id)){anchor=indexed.id;continue;}
        if(retain.has(indexed.id)){const entries=after.get(anchor)??[];entries.push(indexed);after.set(anchor,entries);}
      }
      next.push(...after.get("")??[]);
      for(const heading of loaded)next.push(heading,...after.get(heading.id)??[]);
    }
    next.push(...tail);
    if (next.length === this.#headings.length && next.every((heading, index) => {
      const previous = this.#headings[index];
      return heading.id === previous.id && heading.level === previous.level && heading.text === previous.text;
    })) return;
    this.#headings = next;
    this.#listeners.forEach(listener => listener());
  }
}

export function EditorLayout({ outlineStore, children, loadOutlineContent }: { outlineStore: EditorOutlineStore; children: ReactNode; loadOutlineContent?: () => Promise<void> }) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  async function navigateHeading(id: string) {
    const layout = layoutRef.current;
    if (!layout) return;
    try {
      if ((!outlineStore.isPayloadLoaded(id) || !layout.querySelector(`[data-orbis-block-id="${CSS.escape(id)}"]`)) && loadOutlineContent) {
        setLoading(true);
        await loadOutlineContent();
      }
      if (layoutRef.current !== layout || !layout.isConnected) return;
      layout.querySelector(".ProseMirror")?.dispatchEvent(new CustomEvent(NAVIGATE_OUTLINE_EVENT, { detail: id }));
    } catch (error) { reportError(error); }
    finally { setLoading(false); }
  }
  const outline = useSyncExternalStore(outlineStore.subscribe, outlineStore.snapshot, outlineStore.snapshot);
  const host = useEditorOutlineHost();
  const [outlineOpen, setOutlineOpen] = useState(true);
  const outlineId = useId();
  const toggle = <Button type="button" size="sm" variant="ghost" className="editor-outline-toggle h-8 gap-2 text-[13px] aria-expanded:bg-transparent max-[1024px]:hidden" aria-expanded={outlineOpen} aria-controls={outlineId} onClick={() => setOutlineOpen(value => !value)}>文档大纲<ChevronDown aria-hidden="true" className={outlineOpen ? undefined : "-rotate-90"} /></Button>;
  return <div ref={layoutRef} className={`editor-layout grid min-h-full grid-cols-[minmax(0,1fr)] px-4 pb-24 min-[1025px]:px-0 min-[1025px]:[&.outline-open]:grid-cols-[minmax(0,1fr)_224px] max-[1024px]:pt-3 max-[1024px]:pb-[60px] max-[641px]:px-0${outlineOpen ? " outline-open" : ""}`}>
    {host ? <Portal container={host}>{toggle}</Portal> : <div className="col-span-full justify-self-end max-[1024px]:hidden">{toggle}</div>}
    {children}
    <aside id={outlineId} hidden={!outlineOpen} className="editor-outline sticky top-2 max-h-[calc(100dvh-190px)] self-start overflow-auto px-5 pt-2 max-[1024px]:hidden" aria-label="文档大纲">
      {outline.length ? <nav aria-label="文档标题" className="space-y-1">{outline.map(item => <Button key={item.id} className={editorOutlineLinkClassName} disabled={loading} title={item.text} style={{ paddingLeft: `${8 + (item.level - 1) * 10}px` }} onClick={event => { event.stopPropagation(); void navigateHeading(item.id); }} variant="ghost">{item.text}</Button>)}</nav> : <p className="px-2 text-xs leading-5 text-muted-foreground">添加标题后，这里会自动生成大纲。</p>}
    </aside>
  </div>;
}
