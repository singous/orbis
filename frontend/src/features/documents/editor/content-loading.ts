import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { BlockLoadState } from "./content-window";

export const contentLoadingKey = new PluginKey<DecorationSet>("orbis-content-loading");

type Options = {
  states: () => ReadonlyMap<string, BlockLoadState>;
  load: (id: string) => Promise<void>;
};

function decorations(doc: ProseMirrorNode, options: Options): DecorationSet {
  const widgets: Decoration[] = [];
  const pending = new Map([...options.states()].filter(([, state]) => !state.children_loaded || !state.payload_loaded));
  if (!pending.size) return DecorationSet.empty;
  doc.descendants((node, position) => {
    const id = node.attrs.orbisId as string | undefined;
    const state = id ? pending.get(id) : undefined;
    if (!state) return;
    widgets.push(Decoration.widget(position + node.nodeSize, () => {
      const shell = document.createElement("div");
      shell.className = "editor-content-loader";
      shell.contentEditable = "false";
      shell.dataset.blockLoader = id;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "editor-content-loader-button";
      button.disabled = Boolean(state.loading);
      button.textContent = state.loading ? "正在载入…" : !state.payload_loaded ? "展开正文" : "载入子内容（" + String(state.child_count - (state.loaded_count??0)) + "）";
      button.addEventListener("mousedown", event => event.preventDefault());
      button.addEventListener("click", () => { void options.load(id!).catch(() => { /* The session reports the loading failure. */ }); });
      shell.append(button);
      if (state.error) {
        const message = document.createElement("span");
        message.className = "editor-content-loader-error";
        message.setAttribute("role", "alert");
        message.textContent = state.error;
        shell.append(message);
      }
      return shell;
    }, { side: -1, key: "load-" + id + "-" + String(state.cursor) + "-" + String(state.loading) + "-" + String(state.error) }));
    pending.delete(id!);
  });
  return DecorationSet.create(doc, widgets);
}

/** Map persistent decorations on typing; rebuild only on explicit read changes. */
export const OrbisContentLoading = Extension.create<Options>({
  name: "orbisContentLoading",
  addOptions() { return { states: () => new Map(), load: async () => {} }; },
  addProseMirrorPlugins() {
    const options = this.options;
    return [new Plugin<DecorationSet>({
      key: contentLoadingKey,
      state: {
        init: (_, state) => decorations(state.doc, options),
        apply: (transaction, previous) => transaction.getMeta(contentLoadingKey)
          ? decorations(transaction.doc, options)
          : previous.map(transaction.mapping, transaction.doc),
      },
      props: { decorations: state => contentLoadingKey.getState(state) ?? DecorationSet.empty },
      filterTransaction(transaction, state) {
        if (!transaction.docChanged || transaction.getMeta("orbis-content-page")) return true;
        const unloaded = new Set([...options.states()].filter(([, item]) => !item.payload_loaded).map(([id]) => id));
        if (!unloaded.size) return true;
        let allowed = true;
        state.doc.descendants((node, position) => {
          if (!unloaded.has(node.attrs.orbisId as string)) return;
          const mapped = transaction.mapping.map(position);
          const next = transaction.doc.nodeAt(mapped);
          if (!next || !next.eq(node)) allowed = false;
          return false;
        });
        if (!allowed) transaction.setMeta("orbis-rejected-unloaded", true);
        return allowed;
      },
    })];
  },
});
