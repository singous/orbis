import { createExtension } from "@blocknote/core";
import { Fragment, type Node, type ResolvedPos } from "prosemirror-model";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "prosemirror-state";

import { documentBlockDefinition } from "../content/document-components";
import { newBlockId } from "./block-model";

/** Keep the original nodes and their order; split groups around incompatible blocks. */
function normalizeContainer(container: Node): Node[] {
  if (container.type.name !== "blockContainer" || container.childCount < 2) return [container];
  const header = container.firstChild!;
  const childGroup = container.child(1);
  if (childGroup.type.name !== "blockGroup") return [container];
  const children: Node[] = [];
  let changed = false;
  childGroup.forEach((child) => {
    const normalized = normalizeContainer(child);
    changed ||= normalized.length !== 1 || normalized[0] !== child;
    children.push(...normalized);
  });
  const allowed = documentBlockDefinition(header.type.name)?.children;
  if (!Array.isArray(allowed) || children.every((child) => allowed.includes(child.firstChild!.type.name))) {
    return [changed ? container.copy(Fragment.fromArray([header, childGroup.copy(Fragment.fromArray(children))])) : container];
  }

  const result: Node[] = [];
  let run: Node[] = [];
  let retainedId = false;
  const flush = () => {
    if (!run.length) return;
    result.push(container.type.create(
      { ...container.attrs, id: retainedId ? newBlockId() : container.attrs.id },
      [header, childGroup.copy(Fragment.fromArray(run))], container.marks,
    ));
    retainedId = true;
    run = [];
  };
  for (const child of children) {
    if (allowed.includes(child.firstChild!.type.name)) run.push(child);
    else {
      flush();
      result.push(child);
    }
  }
  flush();
  // Keep an empty group's identity and properties when its only child exits.
  if (!retainedId) result.unshift(container.copy(Fragment.from(header)));
  return result;
}

type BlockPoint = { id: string; offset: number };
function blockPoint(position: ResolvedPos): BlockPoint | undefined {
  if (position.nodeAfter?.type.name === "blockContainer") return { id: position.nodeAfter.attrs.id, offset: 0 };
  for (let depth = position.depth; depth > 0; depth -= 1) {
    if (position.node(depth).type.name === "blockContainer") {
      return { id: position.node(depth).attrs.id, offset: position.pos - position.before(depth) };
    }
  }
}

export const documentGroupEditing = createExtension(({ editor }) => ({
  key: "orbisDocumentGroupEditing",
  prosemirrorPlugins: [new Plugin({
    key: new PluginKey("orbisDocumentGroupEditing"),
    appendTransaction(transactions, _oldState, state) {
      if (!editor.isEditable || !transactions.some((transaction) => transaction.docChanged)) return null;
      const replacements: { pos: number; node: Node; replacement: Node[] }[] = [];
      state.doc.firstChild?.forEach((node, offset) => {
        const replacement = normalizeContainer(node);
        if (replacement.length !== 1 || replacement[0] !== node) replacements.push({ pos: offset + 1, node, replacement });
      });
      if (!replacements.length) return null;
      const anchor = blockPoint(state.selection.$anchor);
      const head = blockPoint(state.selection.$head);
      const transaction = state.tr;
      // Replace only affected top-level subtrees, from the end to keep positions stable.
      for (const { pos, node, replacement } of replacements.reverse()) {
        transaction.replaceWith(pos, pos + node.nodeSize, replacement);
      }
      // A replace step maps moved content to a boundary. Restore the same block-relative
      // endpoints so typing, a backwards selection and slash queries keep their place.
      const positions = new Map<string, number>();
      transaction.doc.descendants((node, pos) => {
        if (node.type.name === "blockContainer") positions.set(node.attrs.id, pos);
      });
      const resolve = (point: BlockPoint | undefined) => point && positions.has(point.id) ? positions.get(point.id)! + point.offset : undefined;
      const anchorPos = resolve(anchor);
      const headPos = resolve(head);
      if (state.selection instanceof TextSelection && anchorPos !== undefined && headPos !== undefined) {
        transaction.setSelection(TextSelection.create(transaction.doc, anchorPos, headPos));
      } else if (state.selection instanceof NodeSelection && anchorPos !== undefined) {
        transaction.setSelection(NodeSelection.create(transaction.doc, anchorPos));
      }
      return transaction;
    },
  })],
}));
