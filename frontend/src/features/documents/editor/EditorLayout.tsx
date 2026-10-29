import { reportError } from "../../../shared/api/request-feedback";
import { NAVIGATE_OUTLINE_EVENT } from "./outline-navigation";
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Eye, EyeOff } from "../../../shared/ui/icons";
import { ActionButton } from "../../../shared/ui/ActionButton";
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
      if (!layout.querySelector(`[data-orbis-block-id="${CSS.escape(id)}"]`) && loadOutlineContent) {
        setLoading(true);
        await loadOutlineContent();
      }
      if (layoutRef.current !== layout || !layout.isConnected) return;
      layout.querySelector(".ProseMirror")?.dispatchEvent(new CustomEvent(NAVIGATE_OUTLINE_EVENT, { detail: id }));
    } catch (error) { reportError(error); }
    finally { setLoading(false); }
  }
  const outline = useSyncExternalStore(outlineStore.subscribe, outlineStore.snapshot, outlineStore.snapshot);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  return <div ref={layoutRef} className={`editor-layout${pinned || hovered ? " outline-open" : ""}`}>
    {children}
    <aside className="editor-outline" aria-label="文档大纲" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <ActionButton type="button" className="editor-outline-pin" aria-label={pinned ? "取消大纲常驻" : "大纲常驻"} aria-pressed={pinned} title={pinned ? "取消常驻" : "常驻大纲"} onClick={() => setPinned(value => !value)}>{pinned ? <Eye aria-hidden="true" size={14} /> : <EyeOff aria-hidden="true" size={14} />}</ActionButton>
      <div className="editor-outline-body"><div className="mb-4 text-xs font-semibold text-[var(--muted)]">大纲</div>
        {outline.length ? <nav className="space-y-1">{outline.map(item => <ActionButton key={item.id} className="editor-outline-link" disabled={loading} title={item.text} style={{ paddingLeft: `${(item.level - 1) * 10}px` }} onPress={() => { void navigateHeading(item.id); }}>{item.text}</ActionButton>)}</nav> : <p className="text-xs leading-5 text-[var(--muted-light)]">添加标题后，这里会自动生成大纲。</p>}
      </div>
    </aside>
  </div>;
}
