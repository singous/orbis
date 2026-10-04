import { Extension } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const activeBlockKey = new PluginKey<DecorationSet>("orbis-active-block");
export const ACTIVE_BLOCK_CLASS = "orbis-editing-block";

/** Keep only the caret's block path rendered, including nested leaf blocks. */
function caretPath(state: EditorState): Decoration[] {
  const head = state.selection.$head;
  const path: Decoration[] = [];
  for (let depth = 1; depth <= head.depth; depth += 1) {
    const node = head.node(depth);
    if (!node.isBlock) continue;
    const from = head.before(depth);
    path.push(Decoration.node(from, from + node.nodeSize, { class: ACTIVE_BLOCK_CLASS }));
  }
  return path;
}

/** Chrome can parse a skipped block's first input with its old caret position.
 * Decorations are view state; rendering the active path never changes content. */
export const OrbisActiveBlock = Extension.create({
  name: "orbisActiveBlock",
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: activeBlockKey,
      state: {
        init: (_, state) => DecorationSet.create(state.doc, caretPath(state)),
        apply(transaction, previous, _oldState, state) {
          if (!transaction.docChanged && !transaction.selectionSet) return previous;
          const mapped = previous.map(transaction.mapping, transaction.doc);
          const requested = caretPath(state);
          const existing = mapped.find();
          // Ordinary typing maps the same ancestors. Avoid rebuilding the
          // decoration tree, or indexing unrelated document blocks per key.
          if (existing.length === requested.length && requested.every(item => existing.some(old => old.from === item.from && old.to === item.to))) return mapped;
          return DecorationSet.create(state.doc, requested);
        },
      },
      props: { decorations: state => activeBlockKey.getState(state) ?? DecorationSet.empty },
    })];
  },
});
