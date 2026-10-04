import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Eye, EyeOff } from "../../shared/ui/icons";
import { ActionButton } from "../../shared/ui/ActionButton";
import { extractPlainTextV2, type NoteBlocksV2, type OrbisBlock } from "../notes/block-model";

type Heading = { id: string; text: string; level: number };

/** Only changed headings notify the outline; body keystrokes stay in the editor. */
export class EditorOutlineStore {
  #headings: Heading[] = [];
  #listeners = new Set<() => void>();
  #cache = new WeakMap<OrbisBlock, Heading>();
  #remote: Array<Heading & { root_index: number }> = [];
  #boundary = Infinity;
  #loaded: Heading[] = [];
  setRemote(headings: Array<Heading & { root_index: number }>, boundary: number) { this.#remote = headings; this.#boundary = boundary; this.#publish(); }
  setBoundary(boundary: number) { this.#boundary = boundary; }
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };
  snapshot = () => this.#headings;
  update(blocks: NoteBlocksV2) {
    const next = blocks.blocks.filter(block => block.type === "heading").map(block => {
      let heading = this.#cache.get(block);
      if (!heading) {
        heading = { id: block.id, level: Number(block.props.level ?? 1), text: extractPlainTextV2([{ ...block, children: [] }]) || "未命名标题" };
        this.#cache.set(block, heading);
      }
      return heading;
    });
    this.#loaded = next;
    this.#publish();
  }
  #publish() {
    const next = [...this.#loaded, ...this.#remote.filter(heading => heading.root_index >= this.#boundary)];
    if (next.length === this.#headings.length && next.every((heading, index) => {
      const previous = this.#headings[index];
      return heading.id === previous.id && heading.level === previous.level && heading.text === previous.text;
    })) return;
    this.#headings = next;
    this.#listeners.forEach(listener => listener());
  }
}

export function EditorLayout({ outlineStore, children }: { outlineStore: EditorOutlineStore; children: ReactNode }) {
  const outline = useSyncExternalStore(outlineStore.subscribe, outlineStore.snapshot, outlineStore.snapshot);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  return <div className={`editor-layout${pinned || hovered ? " outline-open" : ""}`}>
    {children}
    <aside className="editor-outline" aria-label="文档大纲" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <ActionButton type="button" className="editor-outline-pin" aria-label={pinned ? "取消大纲常驻" : "大纲常驻"} aria-pressed={pinned} title={pinned ? "取消常驻" : "常驻大纲"} onClick={() => setPinned(value => !value)}>{pinned ? <Eye aria-hidden="true" size={14} /> : <EyeOff aria-hidden="true" size={14} />}</ActionButton>
      <div className="editor-outline-body"><div className="mb-4 text-xs font-semibold text-[var(--muted)]">大纲</div>
        {outline.length ? <nav className="space-y-1">{outline.map(item => <div key={item.id} className="truncate rounded-md py-1.5 text-xs text-[var(--muted)]" style={{ paddingLeft: `${(item.level - 1) * 10}px` }}>{item.text}</div>)}</nav> : <p className="text-xs leading-5 text-[var(--muted-light)]">添加标题后，这里会自动生成大纲。</p>}
      </div>
    </aside>
  </div>;
}
