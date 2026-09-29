import { Extension } from "@tiptap/core";
import { Fragment, type Node as PMNode, type ResolvedPos } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

import { documentBlockDefinition } from "../content/document-components";
import { newBlockId } from "./block-model";

function childKind(node: PMNode): string {
  if (node.type.name === "orbisContainer" && node.firstChild) return childKind(node.firstChild);
  return ["orbisComponent", "orbisContainer"].includes(node.type.name) ? String(node.attrs.kind) : node.type.name;
}

/** A constrained group must contain only its declared child kinds. Move
 * pasted or newly inserted unrelated blocks outside, preserving their order. */
function normalizeNode(node: PMNode): PMNode[] {
  if (!node.childCount) return [node];
  const children: PMNode[] = [];
  let changed = false;
  node.forEach((child) => {
    const replacement = normalizeNode(child);
    changed ||= replacement.length !== 1 || replacement[0] !== child;
    children.push(...replacement);
  });
  const allowed = node.type.name === "orbisComponent" ? documentBlockDefinition(String(node.attrs.kind))?.children : undefined;
  if (!Array.isArray(allowed) || children.every((child) => allowed.includes(childKind(child)))) {
    return [changed ? node.copy(Fragment.fromArray(children)) : node];
  }
  const result: PMNode[] = [];
  let run: PMNode[] = [];
  let usedId = false;
  const flush = () => {
    if (!run.length) return;
    result.push(node.type.create({ ...node.attrs, orbisId: usedId ? newBlockId() : node.attrs.orbisId }, Fragment.fromArray(run), node.marks));
    usedId = true;
    run = [];
  };
  for (const child of children) {
    if (allowed.includes(childKind(child))) run.push(child);
    else { flush(); result.push(child); }
  }
  flush();
  if (!usedId) result.unshift(node.type.create(node.attrs, null, node.marks));
  return result;
}

type BlockPoint = { id: string; offset: number };
function blockPoint(position: ResolvedPos): BlockPoint | undefined {
  for (let depth = position.depth; depth > 0; depth -= 1) {
    const id = position.node(depth).attrs.orbisId;
    if (typeof id === "string") return { id, offset: position.pos - position.before(depth) };
  }
  return undefined;
}

export const OrbisGroupEditing = Extension.create({
  name: "orbisGroupEditing",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      key: new PluginKey("orbisGroupEditing"),
      appendTransaction(transactions, _oldState, state) {
        if (!editor.isEditable || !transactions.some((transaction) => transaction.docChanged)) return null;
        const replacements: Array<{ pos: number; node: PMNode; replacement: PMNode[] }> = [];
        state.doc.forEach((node, pos) => {
          const replacement = normalizeNode(node);
          if (replacement.length !== 1 || replacement[0] !== node) replacements.push({ pos, node, replacement });
        });
        if (!replacements.length) return null;
        const anchor = blockPoint(state.selection.$anchor);
        const head = blockPoint(state.selection.$head);
        const transaction = state.tr;
        for (const { pos, node, replacement } of replacements.reverse()) transaction.replaceWith(pos, pos + node.nodeSize, replacement);
        const positions = new Map<string, number>();
        transaction.doc.descendants((node, pos) => {
          if (typeof node.attrs.orbisId === "string") positions.set(node.attrs.orbisId, pos);
        });
        const resolve = (point?: BlockPoint) => point && positions.has(point.id) ? Math.min(transaction.doc.content.size, positions.get(point.id)! + point.offset) : undefined;
        const anchorPos = resolve(anchor);
        const headPos = resolve(head);
        if (state.selection instanceof TextSelection && anchorPos !== undefined && headPos !== undefined) {
          transaction.setSelection(TextSelection.between(transaction.doc.resolve(anchorPos), transaction.doc.resolve(headPos)));
        } else if (state.selection instanceof NodeSelection && anchorPos !== undefined) {
          transaction.setSelection(NodeSelection.create(transaction.doc, anchorPos));
        }
        return transaction;
      },
    })];
  },
});
