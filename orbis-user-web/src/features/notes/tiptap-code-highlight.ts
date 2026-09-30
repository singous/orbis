import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { highlightCode } from "../content/code-highlight";

type HighlightSpan = { from: number; to: number; className: string };
type CodeBlock = { node: ProseMirrorNode; pos: number; key: object };
type HighlightState = { decorations: DecorationSet; blocks: CodeBlock[] };

function codeSpans(node: ProseMirrorNode): HighlightSpan[] {
  const html = highlightCode(node.textContent, String(node.attrs.language ?? "text"));
  if (!html) return [];
  const result: HighlightSpan[] = [];
  const root = document.createElement("div");
  root.innerHTML = html;
  let offset = 1;
  function visit(element: ChildNode) {
    if (element.nodeType === globalThis.Node.TEXT_NODE) { offset += element.textContent?.length ?? 0; return; }
    const start = offset;
    element.childNodes.forEach(visit);
    if (element instanceof HTMLElement && element.className && offset > start) result.push({ from: start, to: offset, className: element.className });
  }
  root.childNodes.forEach(visit);
  return result;
}

/** Map existing colors through edits; only changed code nodes need new spans. */
function updateHighlights(doc: ProseMirrorNode, cache: WeakMap<ProseMirrorNode, HighlightSpan[]>, previous?: HighlightState, transaction?: Transaction): HighlightState {
  const mappedBlocks = new Map<number, CodeBlock>();
  for (const block of previous?.blocks ?? []) {
    const mapped = transaction!.mapping.mapResult(block.pos);
    if (!mapped.deleted) mappedBlocks.set(mapped.pos, block);
  }
  const blocks: CodeBlock[] = [];
  const retained = new Set<object>();
  const additions: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return !node.isTextblock;
    const old = mappedBlocks.get(pos);
    if (old?.node === node) {
      retained.add(old.key);
      blocks.push({ ...old, pos });
      return false;
    }
    const key = {};
    let spans = cache.get(node);
    if (!spans) { spans = codeSpans(node); cache.set(node, spans); }
    for (const span of spans) additions.push(Decoration.inline(pos + span.from, pos + span.to, { class: span.className }, { codeBlock: key }));
    blocks.push({ node, pos, key });
    return false;
  });
  let decorations = previous ? previous.decorations.map(transaction!.mapping, doc) : DecorationSet.empty;
  if (previous) decorations = decorations.remove(decorations.find().filter((item) => !retained.has(item.spec.codeBlock)));
  return { decorations: decorations.add(doc, additions), blocks };
}

export const OrbisCodeHighlight = Extension.create({
  name: "orbisCodeHighlight",
  addProseMirrorPlugins() {
    const cache = new WeakMap<ProseMirrorNode, HighlightSpan[]>();
    return [new Plugin<HighlightState>({
      key: new PluginKey("orbisCodeHighlight"),
      state: {
        init: (_, state) => updateHighlights(state.doc, cache),
        apply: (transaction, current) => transaction.docChanged ? updateHighlights(transaction.doc, cache, current, transaction) : current,
      },
      props: { decorations(state) { return this.getState(state)?.decorations; } },
    })];
  },
});
