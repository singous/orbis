import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { locateEditorBlocks } from './block-commands';

export type BlockSelectionState = { ids: string[]; anchorId: string | null; focusId: string | null; targetId?: string | null };
export const blockSelectionKey = new PluginKey<BlockSelectionState>('orbisBlockSelection');
const emptySelection: BlockSelectionState = { ids: [], anchorId: null, focusId: null };

export function setBlockSelection(editor: Editor, ids: string[], anchorId: string | null = ids[0] ?? null, focusId: string | null = ids.at(-1) ?? null) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(blockSelectionKey, { ids, anchorId, focusId }).setMeta('addToHistory', false));
}
export function setBlockTarget(editor: Editor, targetId: string | null) {
  if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(blockSelectionKey, {...(blockSelectionKey.getState(editor.state) ?? emptySelection), targetId}).setMeta('addToHistory', false));
}
export function clearBlockSelection(editor: Editor) { setBlockSelection(editor, []); }

export function selectBlock(editor: Editor, id: string, options: { shift?: boolean; toggle?: boolean } = {}) {
  const entries = locateEditorBlocks(editor.state.doc);
  const target = entries.find((entry) => entry.id === id);
  if (!target) return;
  const current = blockSelectionKey.getState(editor.state) ?? emptySelection;
  const anchor = entries.find((entry) => entry.id === current.anchorId);
  let ids = [id];
  if (options.shift && anchor && anchor.parentId === target.parentId) {
    const siblings = entries.filter((entry) => entry.parentId === target.parentId);
    const a = siblings.indexOf(anchor), b = siblings.indexOf(target);
    ids = siblings.slice(Math.min(a,b), Math.max(a,b)+1).map((entry) => entry.id);
  } else if (options.toggle) {
    const picked = new Set(current.ids);
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    ids = entries.filter((entry) => picked.has(entry.id)).map((entry) => entry.id);
  }
  const selected = entries.filter((entry) => ids.includes(entry.id));
  ids = selected.filter((entry) => !selected.some((parent) => parent !== entry && parent.pos < entry.pos && parent.pos + parent.node.nodeSize > entry.pos)).map((entry) => entry.id);
  setBlockSelection(editor, ids, options.shift ? current.anchorId ?? id : id, id);
}

export function isEmbeddedInput(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('input,textarea,select,button,a[href],[role=combobox],[role=tab],[data-orbis-embedded-editor]'));
}

export const OrbisBlockSelection = Extension.create({
  name: 'orbisBlockSelection',
  addProseMirrorPlugins() {
    const editor = this.editor;
    const decorated = new WeakMap<PMNode, { key: string; value: DecorationSet }>();
    return [new Plugin<BlockSelectionState>({
      key: blockSelectionKey,
      state: {
        init: () => emptySelection,
        apply(transaction, current) {
          const requested = transaction.getMeta(blockSelectionKey) as BlockSelectionState | undefined;
          if (requested) return requested;
          if (!transaction.docChanged || !current.ids.length) return current;
          const known = new Set(locateEditorBlocks(transaction.doc).map((entry) => entry.id));
          const ids = current.ids.filter((id) => known.has(id));
          return ids.length === current.ids.length ? current : { ids, anchorId: ids.includes(current.anchorId ?? '') ? current.anchorId : ids[0] ?? null, focusId: ids.includes(current.focusId ?? "") ? current.focusId : ids.at(-1) ?? null };
        },
      },
      props: {
        decorations(state) {
          const ids = blockSelectionKey.getState(state)?.ids ?? [];
          const targetId = blockSelectionKey.getState(state)?.targetId;
          const key = JSON.stringify([ids, targetId]);
          const cached = decorated.get(state.doc);
          if (cached?.key === key) return cached.value;
          const selected = new Set(ids);
          const value = DecorationSet.create(state.doc, locateEditorBlocks(state.doc).map((entry) => Decoration.node(entry.pos, entry.pos + entry.node.nodeSize, {
            'data-orbis-block-id': entry.id,
            class: [selected.has(entry.id) ? 'orbis-block-selected' : '', targetId === entry.id ? 'orbis-block-target' : ''].filter(Boolean).join(' '),
            ...(selected.has(entry.id) ? {'data-orbis-selected':'true'} : {}),
            ...(targetId === entry.id ? {'data-orbis-target':'true'} : {}),
          })));
          decorated.set(state.doc, {key, value});
          return value;
        },
        handleClick() {
          if (blockSelectionKey.getState(editor.state)?.ids.length) clearBlockSelection(editor);
          return false;
        },
        handleKeyDown(view,event) {
          const current=blockSelectionKey.getState(view.state);
          if (!current?.ids.length || event.isComposing || view.composing || isEmbeddedInput(event.target)) return false;
          if (event.key==='Escape') {
            const first=locateEditorBlocks(view.state.doc).find(entry=>entry.id===current.ids[0]);
            clearBlockSelection(editor);
            if(first) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(Math.min(first.pos+1,view.state.doc.content.size)))));
            return true;
          }
          if ((event.metaKey||event.ctrlKey) && event.key.toLowerCase()==='a') {
            setBlockSelection(editor,locateEditorBlocks(view.state.doc).filter(entry=>entry.parentId===null).map(entry=>entry.id)); return true;
          }
          if(event.shiftKey && ['ArrowUp','ArrowDown'].includes(event.key)) {
            const entries=locateEditorBlocks(view.state.doc); const anchor=entries.find(entry=>entry.id===current.anchorId);
            const siblings=entries.filter(entry=>entry.parentId===anchor?.parentId);
            const edge=current.focusId??current.anchorId;
            const next=siblings[siblings.findIndex(entry=>entry.id===edge)+(event.key==='ArrowUp'?-1:1)];
            if(next)selectBlock(editor,next.id,{shift:true});return true;
          }
          return false;
        },
      },
    })];
  },
});
