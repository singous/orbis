import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { highlightCode } from "../content/code-highlight";

/** Decorations color the live source without changing its stored content. */
function decorations(doc: ProseMirrorNode): DecorationSet {
  const result: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return;
    const html = highlightCode(node.textContent, String(node.attrs.language ?? "text"));
    if (!html) return false;
    const root = document.createElement("div");
    root.innerHTML = html;
    let offset = pos + 1;
    function visit(element: ChildNode) {
      if (element.nodeType === globalThis.Node.TEXT_NODE) { offset += element.textContent?.length ?? 0; return; }
      const start = offset;
      element.childNodes.forEach(visit);
      if (element instanceof HTMLElement && element.className && offset > start) result.push(Decoration.inline(start, offset, { class: element.className }));
    }
    root.childNodes.forEach(visit);
    return false;
  });
  return DecorationSet.create(doc, result);
}

export const OrbisCodeHighlight = Extension.create({
  name: "orbisCodeHighlight",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("orbisCodeHighlight"),
      state: { init: (_, state) => decorations(state.doc), apply: (transaction, current) => transaction.docChanged ? decorations(transaction.doc) : current },
      props: { decorations(state) { return this.getState(state); } },
    })];
  },
});
