import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { documentBlockDefinition } from "../../content/document-components";
import { canonicalJSON, newBlockId, type OrbisBlock } from "../block-model";
import { fromTiptapDocument, toTiptapDocument } from "../tiptap-model";
import { blockActionAvailability } from "./block-capabilities";
import { blockActionNeedsRead } from "./block-action-read";
import { cloneBlockTree, editBlockChildren, emptyParagraph, indexBlocks, mapBlockTree, normalizeBlockSelection, type BlockAction } from "./block-tree";

export type { BlockAction } from "./block-tree";
export type BlockCommandResult = { ok: boolean; selectedIds: string[]; message?: string };
export type EditorBlockAddress = { id: string; pos: number; node: PMNode; parentId: string | null };
const OWNED_NODES = new Set(["paragraph", "heading", "codeBlock", "horizontalRule", "blockquote", "listItem", "taskItem", "table", "orbisComponent", "orbisMedia", "orbisDrawing", "orbisToggle", "orbisContainer"]);
const OWN_CONTENT_PARENTS = new Set(["orbisComponent", "orbisToggle", "blockquote"]);

const addressCache = new WeakMap<PMNode, EditorBlockAddress[]>();

export function locateEditorBlocks(doc: PMNode): EditorBlockAddress[] {
  const cached = addressCache.get(doc);
  if (cached) return cached;
  const result: EditorBlockAddress[] = [];
  const visit = (node: PMNode, pos: number, parentId: string | null, parent: PMNode | null, childIndex: number) => {
    const synthetic = (parent?.type.name === "orbisContainer" && childIndex === 0)
      || (node.type.name === "paragraph" && ((["listItem", "taskItem"].includes(parent?.type.name ?? "") && childIndex === 0) || ["tableCell", "tableHeader"].includes(parent?.type.name ?? "")
        || (childIndex === 0 && node.attrs.orbisOwn && OWN_CONTENT_PARENTS.has(parent?.type.name ?? ""))));
    const id = node.attrs.orbisId;
    const owned = !synthetic && OWNED_NODES.has(node.type.name) && typeof id === "string" && Boolean(id);
    if (owned) result.push({ id, pos, node, parentId });
    if (node.type.name === "table") return;
    node.forEach((child, offset, index) => visit(child, pos + 1 + offset, owned ? id : parentId, node, index));
  };
  doc.forEach((node, pos, index) => visit(node, pos, null, doc, index));
  addressCache.set(doc, result);
  return result;
}

/** Resolve any text/table/synthetic position to its outer persisted block. */
export function ownedOrbisBlock(doc: PMNode, pos: number): EditorBlockAddress | undefined {
  return locateEditorBlocks(doc).filter((address) => pos >= address.pos && pos < address.pos + address.node.nodeSize).at(-1);
}

function convert(block: OrbisBlock, target: string, level?: number): OrbisBlock {
  const props = { ...block.props };
  if (target === "heading") props.level = level ?? Number(props.level ?? 1);
  if (target === "checkListItem") props.checked = Boolean(props.checked);
  if (target === "numberedListItem" && props.start !== undefined) props.start = Number(props.start);
  if (target === "codeBlock") props.language ??= "none";
  const content = target === "codeBlock" && Array.isArray(block.content)
    ? block.content.map((part) => part.type === "text" ? part.text : "").join("") : block.content;
  return { ...block, type: target, props, content };
}

/** Call availability first: every transformation here is immutable and atomic. */
export function transformBlockTree(blocks: OrbisBlock[], ids: string[], action: BlockAction): { blocks: OrbisBlock[]; selectedIds: string[] } {
  const index = indexBlocks(blocks);
  const selectedIds = normalizeBlockSelection(blocks, ids);
  const selected = new Set(selectedIds);
  const addresses = selectedIds.map((id) => index.get(id)!);
  const values = addresses.map(({ block }) => block);
  const first = addresses[0]; const last = addresses[addresses.length - 1];
  const remove = () => mapBlockTree(blocks, (block) => selected.has(block.id) ? [] : [block]);
  const insert = (tree: OrbisBlock[], parentId: string | null, position: number, incoming: OrbisBlock[]) => editBlockChildren(tree, parentId, (siblings) => [...siblings.slice(0, position), ...incoming, ...siblings.slice(position)]);
  switch (action.type) {
    case "delete": {
      const next = remove(); const fallback = next.length ? next : [emptyParagraph()];
      return { blocks: fallback, selectedIds: next.length ? [] : [fallback[0].id] };
    }
    case "duplicate": {
      const copies = values.map(cloneBlockTree);
      return { blocks: insert(blocks, last.parentId, last.index + 1, copies), selectedIds: copies.map(({ id }) => id) };
    }
    case "insert": case "paste": {
      const before = action.side === "before"; const anchor = before ? first : last;
      const incoming = action.type === "insert" ? [emptyParagraph()] : action.preserveIds ? structuredClone(action.blocks) : action.blocks.map(cloneBlockTree);
      return { blocks: insert(blocks, anchor.parentId, anchor.index + (before ? 0 : 1), incoming), selectedIds: incoming.map(({ id }) => id) };
    }
    case "move": {
      const next = remove(); const target = indexBlocks(next).get(action.targetId)!;
      return { blocks: action.placement === "inside"
        ? insert(next, target.id, target.block.children.length, values)
        : insert(next, target.parentId, target.index + (action.placement === "after" ? 1 : 0), values), selectedIds };
    }
    case "up": case "down": {
      const parents = new Set(addresses.map(({ parentId }) => parentId)); let next = blocks;
      for (const parentId of parents) next = editBlockChildren(next, parentId, (siblings) => {
        const ordered = [...siblings];
        if (action.type === "up") {
          for (let position = 1; position < ordered.length; position++) if (selected.has(ordered[position].id) && !selected.has(ordered[position - 1].id)) [ordered[position - 1], ordered[position]] = [ordered[position], ordered[position - 1]];
        } else {
          for (let position = ordered.length - 2; position >= 0; position--) if (selected.has(ordered[position].id) && !selected.has(ordered[position + 1].id)) [ordered[position], ordered[position + 1]] = [ordered[position + 1], ordered[position]];
        }
        return ordered;
      });
      return { blocks: next, selectedIds };
    }
    case "indent": {
      const siblings = first.parentId ? index.get(first.parentId)!.block.children : blocks;
      const previous = siblings[first.index - 1];
      return { blocks: insert(remove(), previous.id, previous.children.length, values), selectedIds };
    }
    case "outdent": {
      let next = remove();
      const parents = [...new Set(addresses.map(({ parentId }) => parentId!))];
      // Deep parents first keeps their live addresses valid after promotion.
      parents.sort((a, b) => index.get(b)!.path.length - index.get(a)!.path.length);
      for (const parentId of parents) {
        const owner = indexBlocks(next).get(parentId)!;
        next = insert(next, owner.parentId, owner.index + 1, addresses.filter((address) => address.parentId === parentId).map(({ block }) => block));
      }
      return { blocks: next, selectedIds };
    }
    case "convert": return { blocks: mapBlockTree(blocks, (block) => [selected.has(block.id) ? convert(block, action.target, action.level) : block]), selectedIds };
    case "group": {
      const type = action.kind ?? "group";
      const props = Object.fromEntries(Object.entries(documentBlockDefinition(type)?.props ?? {}).map(([name, rule]) => [name, rule.default]));
      const group: OrbisBlock = { id: newBlockId(), type, props, content: [], children: values };
      return { blocks: insert(remove(), first.parentId, first.index, [group]), selectedIds: [group.id] };
    }
    case "ungroup": {
      const next = mapBlockTree(blocks, (block) => selected.has(block.id) ? block.children : [block]);
      const fallback = next.length ? next : [emptyParagraph()];
      return { blocks: fallback, selectedIds: next.length ? values.flatMap((block) => block.children.map(({ id }) => id)) : [fallback[0].id] };
    }
  }
}

function semanticAttrs(node: PMNode): string {
  return canonicalJSON(Object.fromEntries(Object.entries(node.attrs).filter(([name]) => !["orbisOriginal", "orbisSignature"].includes(name))));
}

/** Preserve live PM nodes (and their NodeViews) even when moved across parents. */
function reuseNodes(previous: PMNode, desired: PMNode, previousBlocks: OrbisBlock[], nextBlocks: OrbisBlock[]): PMNode {
  const oldIndex = indexBlocks(previousBlocks);
  const nextIndex = indexBlocks(nextBlocks);
  const unchanged = new Map<string, PMNode>();
  for (const address of locateEditorBlocks(previous)) {
    if (oldIndex.get(address.id)?.block === nextIndex.get(address.id)?.block) unchanged.set(address.id, address.node);
  }
  // The storage codec deliberately flattens table cells. An unchanged business
  // block must retain its live node before decoding or comparing that fallback.
  // Only real business nodes qualify: a container's synthetic head shares its ID.
  const desiredOwners = new Set(locateEditorBlocks(desired).map(({ node }) => node));
  const candidates = new Map<string, PMNode[]>();
  previous.descendants((node) => {
    if (node.attrs.orbisId) {
      const key = `${node.type.name}:${node.attrs.orbisId}`;
      candidates.set(key, [...(candidates.get(key) ?? []), node]);
    }
  });
  const visit = (node: PMNode): PMNode => {
    const retained = desiredOwners.has(node) ? unchanged.get(node.attrs.orbisId) : undefined;
    if (retained && retained.type === node.type) return retained;
    const children: PMNode[] = []; node.forEach((child) => children.push(visit(child)));
    const rebuilt = node.copy(Fragment.fromArray(children));
    const key = `${node.type.name}:${node.attrs.orbisId}`;
    return candidates.get(key)?.find((old) => semanticAttrs(old) === semanticAttrs(rebuilt) && old.content.eq(rebuilt.content)) ?? rebuilt;
  };
  return visit(desired);
}

/** Internal source snapshots are not authored structure. Node kinds, marks,
 * visible attributes and all child boundaries must survive a duplicate. */
function sameAuthoredStructure(live: PMNode, encoded: PMNode): boolean {
  if (live.type !== encoded.type || live.text !== encoded.text || live.childCount !== encoded.childCount) return false;
  const authorAttrs = (node: PMNode) => Object.fromEntries(Object.entries(node.attrs).filter(([name]) => !name.startsWith("orbis")));
  if (canonicalJSON(authorAttrs(live)) !== canonicalJSON(authorAttrs(encoded))) return false;
  if (canonicalJSON(live.marks.map((mark) => mark.toJSON())) !== canonicalJSON(encoded.marks.map((mark) => mark.toJSON()))) return false;
  for (let index = 0; index < live.childCount; index++) if (!sameAuthoredStructure(live.child(index), encoded.child(index))) return false;
  return true;
}

function duplicatePreservesStructure(editor: Editor, blocks: OrbisBlock[], ids: string[]): boolean {
  const index = indexBlocks(blocks);
  const selectedIds = normalizeBlockSelection(blocks, ids);
  const selectedBlocks = selectedIds.map((id) => index.get(id)!.block);
  const encoded = editor.schema.nodeFromJSON(toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: selectedBlocks }));
  const encodedNodes = new Map(locateEditorBlocks(encoded).map(({ id, node }) => [id, node]));
  const liveNodes = new Map(locateEditorBlocks(editor.state.doc).map(({ id, node }) => [id, node]));
  return selectedIds.every((id) => {
    const live = liveNodes.get(id); const fallback = encodedNodes.get(id);
    return live && fallback && sameAuthoredStructure(live, fallback);
  });
}

export function executeBlockCommand(editor: Editor, ids: string[], action: BlockAction): BlockCommandResult {
  if (!editor.isEditable) return { ok: false, selectedIds: ids, message: "只读文档不能修改块" };
  if (["duplicate", "ungroup"].includes(action.type) && blockActionNeedsRead(editor, ids)) return { ok: false, selectedIds: ids, message: "子内容尚未完整载入，原内容已保留。" };
  const current = fromTiptapDocument(editor.state.doc).blocks;
  const available = blockActionAvailability(current, ids, action);
  if (!available.ok) return { ...available, selectedIds: ids };
  try {
    if (action.type === "duplicate" && !duplicatePreservesStructure(editor, current, ids)) {
      return { ok: false, selectedIds: ids, message: "所选块包含当前复制格式无法完整保留的内部结构，请先调整块内容后再创建副本" };
    }
    const next = transformBlockTree(current, ids, action);
    const before = editor.state.doc;
    const desired = reuseNodes(before, editor.schema.nodeFromJSON(toTiptapDocument({ schema_version: 2, editor: "blocknote", blocks: next.blocks })), current, next.blocks);
    desired.check();
    const start = before.content.findDiffStart(desired.content);
    if (start === null) return { ok: false, selectedIds: ids, message: "块的位置或类型没有变化" };
    const end = before.content.findDiffEnd(desired.content)!;
    const overlap = start - Math.min(end.a, end.b);
    const oldEnd = overlap > 0 ? end.a + overlap : end.a;
    const newEnd = overlap > 0 ? end.b + overlap : end.b;
    const tr = closeHistory(editor.state.tr).replace(start, oldEnd, desired.slice(start, newEnd));
    const nextAddresses = locateEditorBlocks(tr.doc);
    const previousOwner = ownedOrbisBlock(before, editor.state.selection.from);
    const preserveCaret = ["convert", "move", "up", "down", "indent", "outdent", "group", "ungroup"].includes(action.type);
    const retainedOwner = preserveCaret && previousOwner ? nextAddresses.find(({ id }) => id === previousOwner.id) : undefined;
    const selectedAddress = retainedOwner ?? nextAddresses.find(({ id }) => id === next.selectedIds[0]);
    if (selectedAddress) {
      let position = selectedAddress.pos + 1;
      if (retainedOwner && editor.state.selection.$from.parent.isTextblock) {
        const offset = editor.state.selection.$from.parentOffset;
        if (retainedOwner.node.isTextblock) position += Math.min(offset, retainedOwner.node.content.size);
        else {
          let found = false;
          retainedOwner.node.descendants((node, relative) => {
            if (found) return false;
            if (node.isTextblock) { position = retainedOwner.pos + 2 + relative + Math.min(offset, node.content.size); found = true; return false; }
          });
        }
      }
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(position, tr.doc.content.size))));
    }
    tr.setMeta("orbisBlockCommand", action.type);
    editor.view.dispatch(tr);
    // Text typed immediately after a structural operation starts a new undo event.
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
    return { ok: true, selectedIds: next.selectedIds };
  } catch (error) {
    console.warn("Block command rejected an invalid document transformation", error instanceof Error ? error.name : "UnknownError");
    return { ok: false, selectedIds: ids, message: "此操作无法保留有效的块结构，原内容已保留" };
  }
}
